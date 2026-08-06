import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PROMPT_DEFINITIONS } from '../../src/prompts/registry.js';
import { ALL_TOOL_SPECS } from '../../src/tools/registry.js';

// Compatibility with the client library the ecosystem actually runs.
//
// This server is built on the v2 SDK, but nearly every MCP client in the field — Claude Code,
// Cursor, Codex — still embeds **v1**. `mcp-wire.test.ts` speaks raw JSON-RPC and asserts the
// specific fields it was written to check; this drives the same surface through the real v1
// library, which spawns the process itself and `.parse()`s every response against v1's own Zod
// result schemas. The value is breadth over that surface, not a different surface: it rejects
// anything those schemas don't accept, including shapes nobody thought to write an assertion for.
//
// Calibration, so this isn't over-trusted: the two gates overlap heavily, and no mutation was found
// that this one catches and the raw gate misses (dropping tools, losing annotations and stalling
// shutdown are all caught by both). Treat it as a second opinion from an independent parser, not as
// coverage of a distinct failure class.
//
// Using an SDK `Client` is normally the wrong instrument — a probe built from the package under
// test moves in lockstep with it and hides its regressions. That objection does not apply here:
// v1 is a *different package* on a frozen branch, so it is a genuinely independent implementation.
//
// ⚠️ This gate has a shelf life. v1 receives security fixes only into ~2027-01; once clients have
// moved to v2, delete this file and drop the devDependency rather than carrying an unmaintained
// package to keep a test green.
const DIST_ENTRY = join(import.meta.dirname, '..', '..', 'dist', 'index.mjs');

const freePort = async (): Promise<number> => {
  const s = createServer();
  await new Promise<void>(resolve => s.listen(0, '127.0.0.1', () => resolve()));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>(resolve => s.close(() => resolve()));
  return port;
};

describe.skipIf(!existsSync(DIST_ENTRY))('v1 client compatibility (built dist)', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client(
      { name: 'figwright-v1-compat-gate', version: '1.0.0' },
      { capabilities: {} },
    );
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [DIST_ENTRY],
        env: { ...process.env, FIGWRIGHT_PORT: String(await freePort()) },
        stderr: 'ignore',
      }),
    );
  }, 30_000);

  afterAll(async () => {
    await client?.close();
  });

  it('completes the handshake and reports both capabilities', () => {
    expect(client.getServerVersion()).toMatchObject({ name: 'figwright' });
    expect(client.getServerCapabilities()).toMatchObject({ tools: {}, prompts: {} });
  });

  it('lists every tool through the v1 result schemas', async () => {
    // `listTools()` parses the response against v1's ListToolsResultSchema, so a tool the v2 server
    // advertises in a shape v1 does not accept fails here rather than reaching a user's client.
    const { tools } = await client.listTools();
    expect(tools.map(t => t.name).toSorted()).toEqual(ALL_TOOL_SPECS.map(s => s.name).toSorted());
  });

  it('accepts the 2020-12 schema dialect the v2 server advertises', async () => {
    // The one thing the v1→v2 migration actually changed on the wire. A v1 client never validates
    // against `inputSchema` (its only JSON Schema validation is for `outputSchema`, which no
    // Figwright tool declares) — this pins that the dialect still arrives intact rather than being
    // rejected or stripped on the way in.
    const { tools } = await client.listTools();
    const dialects = new Set(tools.map(t => t.inputSchema.$schema));
    expect([...dialects]).toEqual(['https://json-schema.org/draft/2020-12/schema']);
  });

  it('lists every prompt', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map(p => p.name)).toEqual(PROMPT_DEFINITIONS.map(p => p.name));
  });

  it('calls a no-argument tool and gets a parseable result', async () => {
    const res = await client.callTool({ name: 'ping', arguments: {} });
    expect(res.isError ?? false).toBe(false);
    const content = res.content as { type: string; text: string }[];
    expect(content[0]?.type).toBe('text');
    expect(JSON.parse(content[0]?.text ?? '{}')).toMatchObject({ ok: true, hop: 'server-only' });
  });

  it('calls a tool with arguments', async () => {
    // analyze_project is server-local, so this exercises the argument path without needing a plugin.
    const res = await client.callTool({
      name: 'analyze_project',
      arguments: { root: join(import.meta.dirname, '..', '..') },
    });
    expect(res.isError ?? false).toBe(false);
    expect((res.content as { type: string }[])[0]?.type).toBe('text');
  });

  it('renders a prompt', async () => {
    const res = await client.getPrompt({ name: PROMPT_DEFINITIONS[0]!.name, arguments: {} });
    expect(res.messages.length).toBeGreaterThan(0);
  });
});
