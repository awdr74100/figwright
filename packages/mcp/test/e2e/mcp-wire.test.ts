import { type ChildProcess, spawn } from 'node:child_process';
import { once as onExit } from 'node:events';
import { existsSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { leaderLockPath } from '../../src/election/leader-lock.js';
import { PROMPT_DEFINITIONS } from '../../src/prompts/registry.js';
import { annotationsFor } from '../../src/tools/annotations.js';
import { ALL_TOOL_SPECS } from '../../src/tools/registry.js';
import { toToolDefinition } from '../tool-schema.js';
import { closeSocket, connectFakePlugin } from './_helpers.js';

// The wire gate. Everything else in this repo checks the server from the inside: `tool-schema.ts`
// re-derives JSON Schema with Zod, the other e2e tests drive the relay and never start an MCP
// server at all. None of that observes what an MCP client actually receives — and the SDK is a
// *runtime* dependency that generates every tool's schema and negotiates the protocol version, so
// an SDK release can move the wire while `tsc` stays green. This test is the only thing standing
// between that and a shipped regression.
//
// It speaks raw newline-delimited JSON-RPC at the built dist over real stdio, deliberately NOT
// through the SDK's own `Client`: a probe built out of the package under test can hide that
// package's regression, because both sides move together and the comparison stays silent.
const DIST_ENTRY = join(import.meta.dirname, '..', '..', 'dist', 'index.mjs');

/** What a current client offers. The server may counter-offer; both outcomes are asserted below. */
const LATEST_CLIENT_PROTOCOL = '2025-11-25';
/** The oldest revision the MCP spec still defines — the back-compat floor we promise older clients. */
const OLDEST_CLIENT_PROTOCOL = '2024-11-05';
/** The 2026-era revision `serveStdio` negotiates when a client claims it in its request envelope. */
const MODERN_CLIENT_PROTOCOL = '2026-07-28';

const freePort = async (): Promise<number> => {
  const s = createServer();
  await new Promise<void>(resolve => s.listen(0, '127.0.0.1', () => resolve()));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>(resolve => s.close(() => resolve()));
  return port;
};

interface JsonRpcResponse {
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

/** A live MCP server process plus the raw JSON-RPC channel to it. */
class WireClient {
  private child!: ChildProcess;
  private buffer = '';
  private readonly pending = new Map<number, (r: JsonRpcResponse) => void>();
  private nextId = 1;
  stderr = '';
  /** Relay port this server owns, so a test can attach a plugin to the process it is driving. */
  port = 0;

  async start(): Promise<void> {
    const port = await freePort();
    this.port = port;
    this.child = spawn(process.execPath, [DIST_ENTRY], {
      env: { ...process.env, FIGWRIGHT_PORT: String(port) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stderr?.on('data', (d: Buffer) => {
      this.stderr += d.toString('utf8');
    });
    this.child.stdout?.on('data', (d: Buffer) => {
      this.buffer += d.toString('utf8');
      // Newline-delimited JSON is the stdio binding's framing; anything that isn't a response to a
      // request we sent (notifications, stray output) is ignored rather than failing the parse.
      for (let nl = this.buffer.indexOf('\n'); nl !== -1; nl = this.buffer.indexOf('\n')) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (line === '') continue;
        const msg = JSON.parse(line) as JsonRpcResponse;
        const resolve = this.pending.get(msg.id);
        if (resolve !== undefined) {
          this.pending.delete(msg.id);
          resolve(msg);
        }
      }
    });
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const wait = new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timed out waiting for ${method}\nstderr:\n${this.stderr}`));
      }, 15_000);
      timer.unref();
      this.pending.set(id, r => {
        clearTimeout(timer);
        resolve(r);
      });
    });
    this.child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return wait;
  }

  notify(method: string): void {
    this.child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  }

  /** The opening exchange, returning the server's `initialize` result. */
  async handshake(protocolVersion: string): Promise<Record<string, unknown>> {
    const res = await this.send('initialize', {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: 'figwright-wire-gate', version: '0' },
    });
    if (res.result === undefined) {
      throw new Error(`initialize failed: ${JSON.stringify(res.error)}`);
    }
    this.notify('notifications/initialized');
    return res.result;
  }

  /**
   * Closes stdin — the real "client went away" signal — and waits for the process to actually go,
   * reporting how it went. Returning the exit code rather than swallowing it is the point: a
   * SIGKILL escalation that silently rescued a stuck shutdown would let a hang pass as a pass.
   */
  async stop(): Promise<{ code: number | null; escalated: boolean }> {
    // Each spawned server leaves a leader note for the random port it owned (election/leader-lock).
    // Production overwrites one file per port forever; a suite would otherwise leave one behind per
    // server, per run, on every dev machine and CI runner. Done here rather than in a hook because
    // this file creates WireClients inside individual tests too, not only in beforeAll.
    rmSync(leaderLockPath(this.port), { force: true });
    if (this.child.exitCode !== null) return { code: this.child.exitCode, escalated: false };
    // Subscribe before closing stdin, so a server that exits immediately can't be missed.
    const exited = onExit(this.child, 'exit');
    this.child.stdin?.end();
    let escalated = false;
    const escalate = setTimeout(() => {
      escalated = true;
      this.child.kill('SIGKILL');
    }, 5_000);
    escalate.unref();
    try {
      const [code] = (await exited) as [number | null];
      return { code, escalated };
    } finally {
      clearTimeout(escalate);
    }
  }
}

interface AdvertisedTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

/**
 * Stable stringify for comparing two JSON Schemas. Member order carries no meaning in JSON Schema
 * and the SDK does not promise one — it emits `type` before `$schema` where Zod emits the reverse —
 * so comparing raw `JSON.stringify` output would fail on a difference no client can observe.
 */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).toSorted(([a], [b]) => (a < b ? -1 : 1)),
        )
      : v,
  );

describe.skipIf(!existsSync(DIST_ENTRY))('MCP wire contract (built dist)', () => {
  let client: WireClient;
  let initResult: Record<string, unknown>;
  let tools: AdvertisedTool[];

  beforeAll(async () => {
    client = new WireClient();
    await client.start();
    initResult = await client.handshake(LATEST_CLIENT_PROTOCOL);
    const res = await client.send('tools/list');
    tools = (res.result?.tools ?? []) as AdvertisedTool[];
  }, 30_000);

  afterAll(async () => {
    await client?.stop();
  });

  it('negotiates the protocol version and advertises its capabilities', () => {
    expect(initResult.protocolVersion).toBe(LATEST_CLIENT_PROTOCOL);
    expect(initResult.serverInfo).toMatchObject({ name: 'figwright' });
    // Both primitives Figwright serves must be advertised, or a client never lists them.
    expect(initResult.capabilities).toMatchObject({ tools: {}, prompts: {} });
  });

  it('answers the transport-level ping this era still defines', async () => {
    // The protocol method, not the `ping` tool this server also exposes — clients use it as a
    // liveness probe, and the spec has the receiver answer promptly or risk being dropped. It is
    // also the cleanest probe for era dispatch: the SDK's 2025 method registry lists `ping` and its
    // 2026 one deletes it, so this assertion and its counterpart in the 2026 test below are the
    // only things here that prove `serveStdio` serves two different method sets rather than one
    // superset. Every other method this file exercises exists in both eras.
    const res = await client.send('ping');
    expect(res.error).toBeUndefined();
    expect(res.result).toEqual({});
  });

  it('sends instructions a client can fold into the model prompt', () => {
    // The only channel that reaches every client. Claude Code users get this guidance from the
    // skills; Cursor and Codex users get it from nowhere else, and without it the likeliest first
    // move on a design is to eyeball an image — the one failure this project exists to prevent.
    const instructions = initResult.instructions as string | undefined;
    expect(instructions).toBeTypeOf('string');
    expect(instructions).toContain('get_design_context');
    expect(instructions).toContain('get_screenshot');
    // Clients may put this in the system prompt of every session, so its size is a running cost.
    expect(instructions?.length).toBeLessThan(2_000);

    // Every tool it names must exist. Guidance that points at a renamed or removed tool is worse
    // than none: the model follows it and calls something that is not there.
    const cited = [...new Set([...(instructions ?? '').matchAll(/`([a-z_]+)`/g)].map(m => m[1]))];
    expect(cited.length).toBeGreaterThan(0);
    expect(cited.filter(name => !tools.some(t => t.name === name))).toEqual([]);
  });

  it('advertises exactly the registered tool set', () => {
    expect(tools.map(t => t.name).toSorted()).toEqual(ALL_TOOL_SPECS.map(s => s.name).toSorted());
  });

  it('advertises each tool with the JSON Schema its spec declares', () => {
    // The expected side is derived from the spec's own schema independently of the SDK, so this catches an
    // SDK release that changes schema generation — the failure mode with no other gate in the repo.
    // Report the first real difference rather than a bare list of names: when this fails, what
    // matters is *how* the generated schema moved, and that is what the next audit needs to read.
    const mismatched = ALL_TOOL_SPECS.flatMap(spec => {
      const advertised = tools.find(t => t.name === spec.name);
      const expected = toToolDefinition(spec);
      if (advertised === undefined) return [{ tool: spec.name, got: '<not advertised>', want: '' }];
      const got = canonical(advertised.inputSchema);
      const want = canonical(expected.inputSchema);
      if (advertised.description === expected.description && got === want) return [];
      return [{ tool: spec.name, got, want }];
    });
    expect(mismatched.slice(0, 2)).toEqual([]);
  });

  it('advertises the JSON Schema dialect the current spec revision expects', () => {
    const dialects = new Set(tools.map(t => t.inputSchema.$schema));
    expect([...dialects]).toEqual(['https://json-schema.org/draft/2020-12/schema']);
  });

  it('advertises the annotation values each tool kind is supposed to carry', () => {
    // Pinned as literals on purpose. The check below compares the wire against `annotationsFor`,
    // which cannot tell a correct derivation from a broken one — flip the function and both sides
    // move together and it stays green. These are what the MCP spec means, so they are what the
    // wire has to say: a client uses readOnlyHint to decide whether a call needs confirmation, and
    // destructiveHint to decide how loudly to ask.
    const advertised = (name: string): unknown => tools.find(t => t.name === name)?.annotations;
    expect(advertised('get_node')).toEqual({ readOnlyHint: true });
    expect(advertised('analyze_project')).toEqual({ readOnlyHint: true });
    expect(advertised('set_fills')).toEqual({ readOnlyHint: false, destructiveHint: false });
    expect(advertised('delete_nodes')).toEqual({ readOnlyHint: false, destructiveHint: true });
  });

  it('advertises annotations derived from each spec', () => {
    const mismatched = ALL_TOOL_SPECS.filter(
      spec =>
        JSON.stringify(tools.find(t => t.name === spec.name)?.annotations) !==
        JSON.stringify(annotationsFor(spec)),
    );
    expect(mismatched.map(s => s.name)).toEqual([]);
  });

  it('advertises every registered prompt with its argument list', async () => {
    const res = await client.send('prompts/list');
    const prompts = (res.result?.prompts ?? []) as { name: string }[];
    expect(prompts.map(p => p.name)).toEqual(PROMPT_DEFINITIONS.map(p => p.name));
    expect(prompts).toEqual(PROMPT_DEFINITIONS.map(p => expect.objectContaining({ ...p })));
  });

  it('answers a real tools/call without a plugin connected', async () => {
    const res = await client.send('tools/call', { name: 'ping', arguments: {} });
    const content = res.result?.content as { type: string; text: string }[];
    expect(content[0]?.type).toBe('text');
    // ping answers from the server itself, so it reports server-only reachability and no plugin —
    // proof the handler ran end to end rather than the SDK short-circuiting the call.
    expect(JSON.parse(content[0]?.text ?? '{}')).toMatchObject({
      ok: true,
      hop: 'server-only',
      plugin: null,
      server: { role: 'leader' },
    });
  });

  it('warns on a real tools/call when the connected plugin is out of date', async () => {
    // The assembled product, over real stdio, against a real plugin socket. Every piece of this had
    // unit coverage and the wiring in index.ts had none: deleting the append there left all 1387
    // tests green. A warning that is not actually attached reaches nobody.
    const server = new WireClient();
    await server.start();
    await server.handshake(LATEST_CLIENT_PROTOCOL);
    const plugin = await connectFakePlugin({
      port: server.port,
      clientVersion: '0.0.1',
      handlers: { get_selection: () => ({ pageId: '1:1', pageName: 'Page 1', nodes: [] }) },
    });

    try {
      const res = await server.send('tools/call', { name: 'get_selection', arguments: {} });
      const content = res.result?.content as { type: string; text: string }[];

      // The result the agent asked for is untouched and still first.
      expect(JSON.parse(content[0]?.text ?? '{}')).toMatchObject({ pageName: 'Page 1' });
      // The warning rides alongside it, not inside it.
      expect(content).toHaveLength(2);
      expect(content[1]?.text).toMatch(/OUT OF DATE/);
      expect(content[1]?.text).toMatch(/older than this server/i);
    } finally {
      closeSocket(plugin);
      await server.stop();
    }
  }, 30_000);

  it('explains a METHOD_NOT_FOUND from an out-of-date plugin instead of leaving it bare', async () => {
    // What an old plugin does loudest: nine tools in the last shipped build have no handler in it.
    // Bare, that error reads as "this tool is broken" and the agent goes looking for another way
    // round; attributed, the user gets told to update.
    const server = new WireClient();
    await server.start();
    await server.handshake(LATEST_CLIENT_PROTOCOL);
    const plugin = await connectFakePlugin({
      port: server.port,
      clientVersion: '0.0.1',
      // No handler for the tool called below — exactly what a plugin that predates it does.
      handlers: {},
    });

    try {
      const res = await server.send('tools/call', { name: 'get_selection', arguments: {} });

      expect(res.result?.isError).toBe(true);
      const content = res.result?.content as { type: string; text: string }[];
      const text = content.map(c => c.text).join('');
      expect(text).toMatch(/OUT OF DATE/);
      expect(text).toMatch(/older than this server/i);
    } finally {
      closeSocket(plugin);
      await server.stop();
    }
  }, 30_000);

  it('leaves a real tools/call alone when the plugin is current', async () => {
    const server = new WireClient();
    await server.start();
    await server.handshake(LATEST_CLIENT_PROTOCOL);
    const plugin = await connectFakePlugin({
      port: server.port,
      handlers: { get_selection: () => ({ pageId: '1:1', pageName: 'Page 1', nodes: [] }) },
    });

    try {
      const res = await server.send('tools/call', { name: 'get_selection', arguments: {} });
      const content = res.result?.content as { type: string; text: string }[];

      expect(content).toHaveLength(1);
    } finally {
      closeSocket(plugin);
      await server.stop();
    }
  }, 30_000);

  it('surfaces a bad-argument call as a tool error the model can read, not a transport failure', async () => {
    const res = await client.send('tools/call', {
      name: 'get_node',
      arguments: { nodeId: 42 },
    });
    // isError keeps the failure inside the tool result so the model sees it and can correct itself;
    // a JSON-RPC error would surface as a client-level failure instead.
    expect(res.result?.isError).toBe(true);
    expect(res.error).toBeUndefined();
  });

  it('rejects a batch whose inner op could not have worked, without a plugin in the room', async () => {
    // The half of the batch check that only the assembled server exercises. batch's schema calls
    // ops[].params a free-form record, so the SDK passes this call through; the refusal has to come
    // from the handler wiring in index.ts, which had no coverage of its own. No plugin is connected,
    // so a call that got past the check would sit in the relay queue until its budget expired —
    // answering at once is itself the evidence that it did not.
    const res = await client.send('tools/call', {
      name: 'batch',
      arguments: {
        ops: [
          { tool: 'rename_node', params: { nodeId: '1:1', name: 'fine' } },
          { tool: 'set_opacity', params: { nodeId: '1:1', opacity: 'half' } },
        ],
      },
    });
    expect(res.result?.isError).toBe(true);
    const content = res.result?.content as { type: string; text: string }[];
    expect(content[0]?.text).toMatch(/ops\[1\]/);
    expect(content[0]?.text).toMatch(/opacity/);
  });

  it('rejects a call to a tool it does not advertise', async () => {
    const res = await client.send('tools/call', { name: 'no_such_tool', arguments: {} });
    expect(res.error?.code).toBe(-32602);
  });

  it('still serves a client that opens with the oldest supported protocol revision', async () => {
    // Clients ship wildly different SDK versions; the failure mode of a protocol-constant change is
    // exactly that an older client stops being served, and it is invisible from the newest one.
    const old = new WireClient();
    await old.start();
    try {
      const result = await old.handshake(OLDEST_CLIENT_PROTOCOL);
      expect(result.protocolVersion).toBe(OLDEST_CLIENT_PROTOCOL);
      const res = await old.send('tools/list');
      expect((res.result?.tools as unknown[] | undefined)?.length).toBe(ALL_TOOL_SPECS.length);
    } finally {
      await old.stop();
    }
  }, 30_000);

  it('serves the 2026-07-28 revision to a client that claims it', async () => {
    // This is the whole reason `src/index.ts` hands a factory to `serveStdio` instead of wiring a
    // `StdioServerTransport` itself: the era is chosen per connection from the opening exchange.
    // On stdio there is no header layer, so the signal is the request's `_meta` envelope claim — a
    // claim-less message is 2025-era traffic and never reaches the modern arm.
    const modern = new WireClient();
    await modern.start();
    try {
      const meta = {
        'io.modelcontextprotocol/protocolVersion': MODERN_CLIENT_PROTOCOL,
        'io.modelcontextprotocol/clientCapabilities': {},
      };
      const discover = await modern.send('server/discover', { _meta: meta });
      expect(discover.result?.supportedVersions).toEqual([MODERN_CLIENT_PROTOCOL]);
      expect(discover.result?.capabilities).toMatchObject({ tools: {}, prompts: {} });

      // The same registrations must serve both eras — a modern client sees the identical tool set.
      const res = await modern.send('tools/list', { _meta: meta });
      expect((res.result?.tools as unknown[] | undefined)?.length).toBe(ALL_TOOL_SPECS.length);

      // ...but the method set is not the same: 2026-07-28 deleted `ping`, so the era has to
      // withhold it. Serving it here would mean era selection degraded into a union of both
      // registries — a change `tsc` cannot see, since neither registry is a type this repo names.
      const gone = await modern.send('ping', { _meta: meta });
      expect(gone.result).toBeUndefined();
      expect(gone.error?.code).toBe(-32_601);
    } finally {
      await modern.stop();
    }
  }, 30_000);

  it('exits cleanly when the client goes away mid-session', async () => {
    // The transport is owned by `serveStdio`, which pins a server instance for the connection and
    // has to be closed on the way out. Shutdown also tears down the relay, and this process holds
    // the port until it exits — a shutdown that stalls here is the zombie-leader failure that
    // `lifecycle.ts` exists to prevent, one layer down from where `process-lifecycle.test.ts`
    // checks it (that one never opens an MCP session, so it never has an instance to close).
    const live = new WireClient();
    await live.start();
    await live.handshake(LATEST_CLIENT_PROTOCOL);
    await live.send('tools/call', { name: 'ping', arguments: {} });

    const started = Date.now();
    const { code, escalated } = await live.stop();
    expect(escalated).toBe(false);
    expect(code).toBe(0);
    // The hard-exit backstop fires at 5s; a graceful exit should be far inside that.
    expect(Date.now() - started).toBeLessThan(4_000);
  }, 30_000);
});
