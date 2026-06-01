import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  createRequest,
  createResponse,
  decodeEnvelope,
  encodeEnvelope,
  ErrorCode,
  newId,
  PROTOCOL_VERSION,
  type HelloParams,
  type RpcRequest,
  type RpcResponse,
  RpcResponseSchema,
  SystemMethod,
} from '@figma-mcp-relay/shared';
import { decode, encode } from '@msgpack/msgpack';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { attachLeaderEndpoints, PING_PATH, RPC_PATH } from '../../src/election/leader-endpoints.js';
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

const startLeader = async (rpcTimeoutMs = 5_000): Promise<Bound> => {
  const http = createServer();
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', () => resolve()));
  const port = (http.address() as AddressInfo).port;
  const relay = new Relay({ serverVersion: 'test-1.0.0', server: http });
  const detach = attachLeaderEndpoints(http, {
    relay,
    serverVersion: 'test-1.0.0',
    rpcTimeoutMs,
  });
  const b: Bound = { http, relay, port, detach, plugins: [] };
  all.push(b);
  return b;
};

const attachFakePlugin = async (
  b: Bound,
  handle: (method: string, params: unknown) => Promise<unknown>,
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
    clientVersion: '0.0.0',
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
    expect(body.serverVersion).toBe('test-1.0.0');
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
            clientVersion: '0.0.0',
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
});
