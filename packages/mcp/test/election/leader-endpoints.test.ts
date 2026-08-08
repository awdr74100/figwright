import { createServer, type Server as HttpServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  createRequest,
  createResponse,
  decodeEnvelope,
  encodeEnvelope,
  ErrorCode,
  MIN_PLUGIN_VERSION,
  newId,
  PROTOCOL_VERSION,
  type HelloParams,
  type RpcRequest,
  type RpcResponse,
  RpcResponseSchema,
  SystemMethod,
} from '@figwright/shared';
import { decode, encode } from '@msgpack/msgpack';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import {
  ABDICATE_PATH,
  attachLeaderEndpoints,
  type LeaderEndpointDeps,
  PING_PATH,
  RPC_PATH,
} from '../../src/election/leader-endpoints.js';
import { Relay } from '../../src/relay/relay.js';

interface Bound {
  http: HttpServer;
  relay: Relay;
  port: number;
  detach: () => void;
  plugins: WebSocket[];
}

const all: Bound[] = [];

afterEach(async () => {
  await Promise.all(
    all.map(async b => {
      for (const ws of b.plugins) ws.close();
      b.detach();
      await b.relay.stop();
      await new Promise<void>(resolve => b.http.close(() => resolve()));
    }),
  );
  all.length = 0;
});

const startLeader = async (
  rpcTimeoutMs = 5_000,
  extraDeps: Partial<LeaderEndpointDeps> = {},
): Promise<Bound> => {
  const http = createServer();
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', () => resolve()));
  const port = (http.address() as AddressInfo).port;
  const relay = new Relay({ serverVersion: '1.0.0', server: http });
  const detach = attachLeaderEndpoints(http, {
    relay,
    serverVersion: '1.0.0',
    rpcTimeoutMs,
    ...extraDeps,
  });
  const b: Bound = { http, relay, port, detach, plugins: [] };
  all.push(b);
  return b;
};

const postAbdicate = async (
  port: number,
  body: unknown,
): Promise<{ status: number; body: { ok: boolean; reason?: string } }> => {
  const res = await fetch(`http://127.0.0.1:${port}${ABDICATE_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as { ok: boolean; reason?: string } };
};

const attachFakePlugin = async (
  b: Bound,
  handle: (method: string, params: unknown) => Promise<unknown>,
  clientVersion: string = MIN_PLUGIN_VERSION,
): Promise<WebSocket> => {
  const ws = new WebSocket(`ws://127.0.0.1:${b.port}`);
  ws.binaryType = 'arraybuffer';
  await new Promise<void>(resolve => ws.once('open', () => resolve()));
  const sessionId = newId();

  let helloResolved: (() => void) | null = null;
  const helloReceived = new Promise<void>(resolve => {
    helloResolved = resolve;
  });

  ws.on('message', async (data: ArrayBuffer) => {
    const env = decodeEnvelope(data);
    if (env.kind === 'res' && helloResolved !== null) {
      helloResolved();
      helloResolved = null;
      return;
    }
    if (
      env.kind === 'req' &&
      env.method !== SystemMethod.Ping &&
      env.method !== SystemMethod.Hello
    ) {
      const result = await handle(env.method, env.params);
      ws.send(encodeEnvelope(createResponse({ id: env.id, sessionId: env.sessionId, result })));
    }
  });

  const helloParams: HelloParams = {
    clientType: 'plugin',
    clientVersion,
    protocolVersion: PROTOCOL_VERSION,
  };
  ws.send(
    encodeEnvelope(
      createRequest({ id: 'h', sessionId, method: SystemMethod.Hello, params: helloParams }),
    ),
  );
  await helloReceived;
  b.plugins.push(ws);
  return ws;
};

const callRpc = async (port: number, req: RpcRequest): Promise<RpcResponse> => {
  const res = await fetch(`http://127.0.0.1:${port}${RPC_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/msgpack' },
    body: Buffer.from(encode(req)),
  });
  const buf = new Uint8Array(await res.arrayBuffer());
  return RpcResponseSchema.parse(decode(buf));
};

describe('leader endpoints', () => {
  it('GET /ping returns server info and plugin count', async () => {
    const b = await startLeader();
    const res = await fetch(`http://127.0.0.1:${b.port}${PING_PATH}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; serverVersion: string; plugins: number };
    expect(body.ok).toBe(true);
    expect(body.serverVersion).toBe('1.0.0');
    expect(body.plugins).toBe(0);

    await attachFakePlugin(b, async () => ({ noop: true }));
    const res2 = await fetch(`http://127.0.0.1:${b.port}${PING_PATH}`);
    const body2 = (await res2.json()) as { plugins: number };
    expect(body2.plugins).toBe(1);
  });

  it('GET /ping exposes activeSessionId for follower-side pin resolution', async () => {
    const b = await startLeader();
    const res = await fetch(`http://127.0.0.1:${b.port}${PING_PATH}`);
    const body = (await res.json()) as { activeSessionId: string | null };
    expect(body.activeSessionId).toBeNull();

    await attachFakePlugin(b, async () => ({ noop: true }));
    const res2 = await fetch(`http://127.0.0.1:${b.port}${PING_PATH}`);
    const body2 = (await res2.json()) as { activeSessionId: string | null };
    expect(body2.activeSessionId).toBe(b.relay.pickActiveSessionId());
    expect(typeof body2.activeSessionId).toBe('string');
  });

  it('POST /rpc honors a sessionId pin and rejects an unknown one', async () => {
    const b = await startLeader();
    await attachFakePlugin(b, async () => ({ pinned: true }));
    const sid = b.relay.pickActiveSessionId();
    expect(typeof sid).toBe('string');

    const ok = await callRpc(b.port, {
      requestId: 'r1',
      toolName: 'get_design_context',
      sessionId: sid,
    });
    expect(ok).toMatchObject({ kind: 'ok', result: { pinned: true } });

    const bad = await callRpc(b.port, {
      requestId: 'r2',
      toolName: 'get_design_context',
      sessionId: 'ghost',
    });
    expect(bad).toMatchObject({ kind: 'err', code: ErrorCode.PluginDisconnected });
  });

  it('POST /rpc forwards to plugin and returns its result', async () => {
    const b = await startLeader();
    await attachFakePlugin(b, async (method, params) => {
      expect(method).toBe('get_selection');
      expect(params).toEqual({ fileKey: 'abc' });
      return { ids: ['1:1', '1:2'] };
    });

    const resp = await callRpc(b.port, {
      requestId: 'r-1',
      toolName: 'get_selection',
      args: { fileKey: 'abc' },
    });
    if (resp.kind !== 'ok') throw new Error(`expected ok, got ${resp.kind}`);
    expect(resp.requestId).toBe('r-1');
    expect(resp.result).toEqual({ ids: ['1:1', '1:2'] });
  });

  it('POST /rpc carries the skew warning back to the follower that asked', async () => {
    // The production half of the warning for anyone whose MCP server is a follower — a normal
    // state, since several servers share one plugin and only one of them holds the relay. Faking
    // this response in the dispatch test proves the follower *reads* it; nothing proved the leader
    // ever *writes* it. Deleting the attachment left all 1387 tests green.
    const b = await startLeader();
    await attachFakePlugin(b, async () => ({ ok: true }), '0.0.1');

    const resp = await callRpc(b.port, { requestId: 'r-skew', toolName: 'set_fills', args: {} });

    if (resp.kind !== 'ok') throw new Error(`expected ok, got ${resp.kind}`);
    expect(resp.notice).toMatch(/older than this server/i);
    expect(resp.notice).toMatch(/unverified/i);
  });

  it('POST /rpc attaches no warning for a current plugin', async () => {
    const b = await startLeader();
    await attachFakePlugin(b, async () => ({ ok: true }));

    const resp = await callRpc(b.port, { requestId: 'r-ok', toolName: 'set_fills', args: {} });

    if (resp.kind !== 'ok') throw new Error(`expected ok, got ${resp.kind}`);
    expect(resp.notice).toBeUndefined();
  });

  it('POST /rpc queues request and surfaces Timeout when no plugin ever connects', async () => {
    const b = await startLeader(50);
    const resp = await callRpc(b.port, {
      requestId: 'r-2',
      toolName: 'whatever',
    });
    if (resp.kind !== 'err') throw new Error(`expected err, got ${resp.kind}`);
    expect(resp.code).toBe(ErrorCode.Timeout);
    expect(resp.requestId).toBe('r-2');
  });

  it('POST /rpc flushes queued call once plugin connects', async () => {
    const b = await startLeader(1_000);
    const respPromise = callRpc(b.port, {
      requestId: 'r-flush',
      toolName: 'late_tool',
      args: { x: 1 },
    });

    await new Promise(r => setTimeout(r, 50));
    expect(b.relay.queuedCount()).toBe(1);

    await attachFakePlugin(b, async (method, params) => {
      expect(method).toBe('late_tool');
      expect(params).toEqual({ x: 1 });
      return { ok: 'flushed' };
    });

    const resp = await respPromise;
    if (resp.kind !== 'ok') throw new Error(`expected ok, got ${resp.kind}`);
    expect(resp.result).toEqual({ ok: 'flushed' });
  });

  it('POST /rpc returns TIMEOUT when plugin does not reply in time', async () => {
    const b = await startLeader(50);
    const ws = new WebSocket(`ws://127.0.0.1:${b.port}`);
    ws.binaryType = 'arraybuffer';
    await new Promise<void>(resolve => ws.once('open', () => resolve()));
    ws.send(
      encodeEnvelope(
        createRequest({
          id: 'h',
          sessionId: newId(),
          method: SystemMethod.Hello,
          params: {
            clientType: 'plugin',
            clientVersion: MIN_PLUGIN_VERSION,
            protocolVersion: PROTOCOL_VERSION,
          } satisfies HelloParams,
        }),
      ),
    );
    await new Promise<void>(resolve => ws.once('message', () => resolve()));
    b.plugins.push(ws);

    const resp = await callRpc(b.port, { requestId: 'r-3', toolName: 'slow_tool' });
    if (resp.kind !== 'err') throw new Error(`expected err, got ${resp.kind}`);
    expect(resp.code).toBe(ErrorCode.Timeout);
  });

  it('POST /rpc rejects invalid msgpack body', async () => {
    const b = await startLeader();
    const res = await fetch(`http://127.0.0.1:${b.port}${RPC_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/msgpack' },
      body: Buffer.from([0xff, 0xff, 0xff]),
    });
    expect(res.status).toBe(400);
  });

  it('POST /rpc rejects schema-invalid request', async () => {
    const b = await startLeader();
    const res = await fetch(`http://127.0.0.1:${b.port}${RPC_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/msgpack' },
      body: Buffer.from(encode({ requestId: 'r-x' })),
    });
    expect(res.status).toBe(400);
    const buf = new Uint8Array(await res.arrayBuffer());
    const parsed = RpcResponseSchema.parse(decode(buf));
    if (parsed.kind !== 'err') throw new Error(`expected err, got ${parsed.kind}`);
    expect(parsed.code).toBe(ErrorCode.InvalidParams);
  });

  it('GET on unknown path returns 404', async () => {
    const b = await startLeader();
    const res = await fetch(`http://127.0.0.1:${b.port}/nope`);
    expect(res.status).toBe(404);
  });

  it('refuses any request carrying an Origin, since only browsers send one', async () => {
    const b = await startLeader();
    const attach = await attachFakePlugin(b, () => Promise.resolve({ pong: true }));
    expect(attach).toBeDefined();

    // The CSRF shape: a simple request needs no preflight, so the page's POST would land and its
    // side effect would happen even though the reply is unreadable.
    const rpc = await fetch(`http://127.0.0.1:${b.port}${RPC_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', origin: 'https://evil.example' },
      body: Buffer.from(encode({ requestId: 'r-csrf', toolName: 'ping' })),
    });
    expect(rpc.status).toBe(403);

    const ping = await fetch(`http://127.0.0.1:${b.port}${PING_PATH}`, {
      headers: { origin: 'https://evil.example' },
    });
    expect(ping.status).toBe(403);

    const abdicate = await fetch(`http://127.0.0.1:${b.port}${ABDICATE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ buildId: 999_999 }),
    });
    expect(abdicate.status).toBe(403);
  });

  it('refuses a request addressed to a rebound domain, on the readable GET path too', async () => {
    const b = await startLeader();

    // What DNS rebinding looks like on the wire: the page believes it is same-origin with
    // attacker.com, so it sends no Origin and *can* read the reply — but Host gives it away.
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: b.port,
          path: PING_PATH,
          method: 'GET',
          headers: { host: 'evil.example:' + String(b.port) },
        },
        res => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it('POST /rpc refuses a media type that would skip the CORS preflight', async () => {
    const b = await startLeader();
    const res = await fetch(`http://127.0.0.1:${b.port}${RPC_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: Buffer.from(encode({ requestId: 'r-ct', toolName: 'ping' })),
    });
    expect(res.status).toBe(415);
  });

  it('POST /abdicate refuses a non-JSON media type', async () => {
    const b = await startLeader();
    const res = await fetch(`http://127.0.0.1:${b.port}${ABDICATE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ buildId: 999_999 }),
    });
    expect(res.status).toBe(415);
  });

  it('GET /ping advertises the buildId (0 when unset)', async () => {
    const bare = await startLeader();
    const bareBody = (await (await fetch(`http://127.0.0.1:${bare.port}${PING_PATH}`)).json()) as {
      buildId: number;
    };
    expect(bareBody.buildId).toBe(0);

    const stamped = await startLeader(5_000, { buildId: 1234 });
    const stampedBody = (await (
      await fetch(`http://127.0.0.1:${stamped.port}${PING_PATH}`)
    ).json()) as { buildId: number };
    expect(stampedBody.buildId).toBe(1234);
  });
});

describe('POST /abdicate', () => {
  it('accepts a strictly newer build and releases after the response flushes', async () => {
    let released = 0;
    const b = await startLeader(5_000, {
      buildId: 100,
      onAbdicate: () => {
        released += 1;
      },
      abdicateQuietWindowMs: 0,
    });
    const { status, body } = await postAbdicate(b.port, { buildId: 200 });
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    // onAbdicate fires on the response's 'finish' — by the time fetch resolved, it flushed.
    await new Promise(r => setTimeout(r, 20));
    expect(released).toBe(1);
  });

  it('refuses an equal or older build', async () => {
    let released = 0;
    const b = await startLeader(5_000, {
      buildId: 100,
      onAbdicate: () => {
        released += 1;
      },
      abdicateQuietWindowMs: 0,
    });
    expect((await postAbdicate(b.port, { buildId: 100 })).body).toEqual({
      ok: false,
      reason: 'stale',
    });
    expect((await postAbdicate(b.port, { buildId: 50 })).body).toEqual({
      ok: false,
      reason: 'stale',
    });
    expect(released).toBe(0);
  });

  it('answers unsupported when no release hook is wired', async () => {
    const b = await startLeader(5_000, { buildId: 100, abdicateQuietWindowMs: 0 });
    expect((await postAbdicate(b.port, { buildId: 200 })).body).toEqual({
      ok: false,
      reason: 'unsupported',
    });
  });

  it('defers while a relay request is in flight', async () => {
    let released = 0;
    const b = await startLeader(5_000, {
      buildId: 100,
      onAbdicate: () => {
        released += 1;
      },
      abdicateQuietWindowMs: 0,
    });
    // No plugin connected → the request queues as pending until its own timeout.
    const pending = b.relay.sendRequest('slow_tool', {}, 1_000).catch(() => {});
    await new Promise(r => setTimeout(r, 20));
    expect((await postAbdicate(b.port, { buildId: 200 })).body).toEqual({
      ok: false,
      reason: 'busy',
    });
    expect(released).toBe(0);
    await pending;
  });

  it('defers inside the quiet window after recent traffic, then accepts once it elapses', async () => {
    let released = 0;
    const b = await startLeader(5_000, {
      buildId: 100,
      onAbdicate: () => {
        released += 1;
      },
      abdicateQuietWindowMs: 150,
    });
    // A completed (timed-out) request leaves no pending entry but stamps lastRequestAt.
    await b.relay.sendRequest('quick_tool', {}, 10).catch(() => {});
    expect((await postAbdicate(b.port, { buildId: 200 })).body).toEqual({
      ok: false,
      reason: 'busy',
    });
    expect(released).toBe(0);

    await new Promise(r => setTimeout(r, 160));
    expect((await postAbdicate(b.port, { buildId: 200 })).body).toEqual({ ok: true });
    await new Promise(r => setTimeout(r, 20));
    expect(released).toBe(1);
  });

  it('rejects malformed bodies', async () => {
    const b = await startLeader(5_000, { buildId: 100, abdicateQuietWindowMs: 0 });
    expect((await postAbdicate(b.port, 'not json{{')).status).toBe(400);
    expect((await postAbdicate(b.port, {})).status).toBe(400);
    expect((await postAbdicate(b.port, { buildId: 'newest' })).status).toBe(400);
  });
});
