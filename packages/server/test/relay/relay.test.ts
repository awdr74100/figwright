import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  createRequest,
  createResponse,
  decodeEnvelope,
  encodeEnvelope,
  type Envelope,
  type HelloParams,
  type HelloResult,
  newId,
  PROTOCOL_VERSION,
  type ResponseEnvelope,
  SystemMethod,
} from '@figma-mcp-relay/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { Relay } from '../../src/relay/relay.js';

interface Bound {
  relay: Relay;
  server: HttpServer;
  port: number;
}

const bound: Bound[] = [];

afterEach(async () => {
  await Promise.all(
    bound.map(async b => {
      await b.relay.stop();
      await new Promise<void>(resolve => b.server.close(() => resolve()));
    }),
  );
  bound.length = 0;
});

const startRelay = async (
  overrides: {
    heartbeatIntervalMs?: number;
    heartbeatMaxMisses?: number;
    disconnectGraceMs?: number;
  } = {},
): Promise<Bound> => {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const relay = new Relay({
    serverVersion: 'test-1.0.0',
    server,
    heartbeatIntervalMs: overrides.heartbeatIntervalMs ?? 60_000,
    heartbeatMaxMisses: overrides.heartbeatMaxMisses ?? 2,
    disconnectGraceMs: overrides.disconnectGraceMs ?? 30_000,
  });
  const b: Bound = { relay, server, port };
  bound.push(b);
  return b;
};

const connect = (port: number): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.binaryType = 'arraybuffer';
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });

const nextMessage = (ws: WebSocket): Promise<ArrayBuffer> =>
  new Promise((resolve, reject) => {
    ws.once('message', data => resolve(data as ArrayBuffer));
    ws.once('error', reject);
  });

const helloParams = (overrides: Partial<HelloParams> = {}): HelloParams => ({
  clientType: 'plugin',
  clientVersion: '0.0.0',
  protocolVersion: PROTOCOL_VERSION,
  ...overrides,
});

describe('Relay hello loop', () => {
  it('accepts a $hello request and returns server info', async () => {
    const { port } = await startRelay();
    const ws = await connect(port);
    const sessionId = newId();
    ws.send(
      encodeEnvelope(
        createRequest({ id: 'h1', sessionId, method: SystemMethod.Hello, params: helloParams() }),
      ),
    );
    const res = decodeEnvelope(await nextMessage(ws)) as ResponseEnvelope;
    expect(res.kind).toBe('res');
    expect(res.id).toBe('h1');
    const result = res.result as HelloResult;
    expect(result.serverVersion).toBe('test-1.0.0');
    expect(result.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(result.sessionResumed).toBe(false);
    ws.close();
  });

  it('rejects non-hello first message', async () => {
    const { port } = await startRelay();
    const ws = await connect(port);
    ws.send(
      encodeEnvelope(
        createRequest({ id: 'x', sessionId: newId(), method: 'something_else' }),
      ),
    );
    const res = decodeEnvelope(await nextMessage(ws));
    expect(res.kind).toBe('err');
    await new Promise(r => ws.once('close', r));
  });

  it('rejects $hello with bad params', async () => {
    const { port } = await startRelay();
    const ws = await connect(port);
    ws.send(
      encodeEnvelope(
        createRequest({
          id: 'h1',
          sessionId: newId(),
          method: SystemMethod.Hello,
          params: { clientType: 'plugin' },
        }),
      ),
    );
    const res = decodeEnvelope(await nextMessage(ws));
    expect(res.kind).toBe('err');
  });

  it('responds to client-initiated $ping with ok result', async () => {
    const { port } = await startRelay();
    const ws = await connect(port);
    const sessionId = newId();
    ws.send(
      encodeEnvelope(
        createRequest({ id: 'h', sessionId, method: SystemMethod.Hello, params: helloParams() }),
      ),
    );
    await nextMessage(ws);
    ws.send(
      encodeEnvelope(createRequest({ id: 'p', sessionId, method: SystemMethod.Ping })),
    );
    const res = decodeEnvelope(await nextMessage(ws)) as ResponseEnvelope;
    expect(res.kind).toBe('res');
    expect(res.id).toBe('p');
    expect(res.result).toEqual({ ok: true });
    ws.close();
  });

  it('closes socket when plugin misses heartbeat', async () => {
    const { port } = await startRelay({ heartbeatIntervalMs: 30, heartbeatMaxMisses: 2 });
    const ws = await connect(port);
    const sessionId = newId();
    ws.send(
      encodeEnvelope(
        createRequest({ id: 'h', sessionId, method: SystemMethod.Hello, params: helloParams() }),
      ),
    );
    await nextMessage(ws);

    const pings: Envelope[] = [];
    ws.on('message', d => {
      try {
        const env = decodeEnvelope(d as ArrayBuffer);
        if (env.kind === 'req' && env.method === SystemMethod.Ping) pings.push(env);
      } catch {
        /* ignore */
      }
    });

    const closeCode = await new Promise<number>(resolve => {
      ws.once('close', code => resolve(code));
    });
    expect(closeCode).toBe(1001);
    expect(pings.length).toBeGreaterThan(0);
  });

  it('plugin responding to $ping keeps connection alive past timeout window', async () => {
    const { port } = await startRelay({ heartbeatIntervalMs: 60, heartbeatMaxMisses: 3 });
    const ws = await connect(port);
    const sessionId = newId();
    ws.send(
      encodeEnvelope(
        createRequest({ id: 'h', sessionId, method: SystemMethod.Hello, params: helloParams() }),
      ),
    );
    await nextMessage(ws);

    let closed = false;
    ws.once('close', () => {
      closed = true;
    });
    ws.on('message', d => {
      const env = decodeEnvelope(d as ArrayBuffer);
      if (env.kind === 'req' && env.method === SystemMethod.Ping) {
        ws.send(
          encodeEnvelope(createResponse({ id: env.id, sessionId, result: { ok: true } })),
        );
      }
    });

    await new Promise(r => setTimeout(r, 300));
    expect(closed).toBe(false);
    ws.close();
  });

  it('resumes session when same sessionId reconnects within grace window', async () => {
    const { port, relay } = await startRelay({ disconnectGraceMs: 1_000 });
    const sessionId = newId();

    const ws1 = await connect(port);
    ws1.send(
      encodeEnvelope(
        createRequest({ id: 'h1', sessionId, method: SystemMethod.Hello, params: helloParams() }),
      ),
    );
    const res1 = decodeEnvelope(await nextMessage(ws1)) as ResponseEnvelope;
    expect((res1.result as HelloResult).sessionResumed).toBe(false);
    ws1.close();
    await new Promise(r => ws1.once('close', r));

    const ws2 = await connect(port);
    ws2.send(
      encodeEnvelope(
        createRequest({ id: 'h2', sessionId, method: SystemMethod.Hello, params: helloParams() }),
      ),
    );
    const res2 = decodeEnvelope(await nextMessage(ws2)) as ResponseEnvelope;
    expect((res2.result as HelloResult).sessionResumed).toBe(true);
    expect(relay.sessions.connected()).toHaveLength(1);
    ws2.close();
  });

  it('expires session after grace window passes without reconnect', async () => {
    const { port, relay } = await startRelay({ disconnectGraceMs: 50 });
    const sessionId = newId();

    const ws1 = await connect(port);
    ws1.send(
      encodeEnvelope(
        createRequest({ id: 'h1', sessionId, method: SystemMethod.Hello, params: helloParams() }),
      ),
    );
    await nextMessage(ws1);
    ws1.close();
    await new Promise(r => ws1.once('close', r));

    await new Promise(r => setTimeout(r, 200));
    expect(relay.sessions.get(sessionId)).toBeUndefined();

    const ws2 = await connect(port);
    ws2.send(
      encodeEnvelope(
        createRequest({ id: 'h2', sessionId, method: SystemMethod.Hello, params: helloParams() }),
      ),
    );
    const res2 = decodeEnvelope(await nextMessage(ws2)) as ResponseEnvelope;
    expect((res2.result as HelloResult).sessionResumed).toBe(false);
    ws2.close();
  });

  it('replaces existing socket if new hello arrives before close fires', async () => {
    const { port, relay } = await startRelay();
    const sessionId = newId();

    const ws1 = await connect(port);
    ws1.send(
      encodeEnvelope(
        createRequest({ id: 'h1', sessionId, method: SystemMethod.Hello, params: helloParams() }),
      ),
    );
    await nextMessage(ws1);

    const ws2 = await connect(port);
    ws2.send(
      encodeEnvelope(
        createRequest({ id: 'h2', sessionId, method: SystemMethod.Hello, params: helloParams() }),
      ),
    );
    const res2 = decodeEnvelope(await nextMessage(ws2)) as ResponseEnvelope;
    expect((res2.result as HelloResult).sessionResumed).toBe(true);

    await new Promise<void>(resolve => {
      if (ws1.readyState === ws1.CLOSED) resolve();
      else ws1.once('close', () => resolve());
    });
    expect(relay.sessions.connected()).toHaveLength(1);
    ws2.close();
  });

  it('accepts multiple concurrent plugin connections', async () => {
    const { port, relay } = await startRelay();
    const ws1 = await connect(port);
    ws1.send(
      encodeEnvelope(
        createRequest({
          id: 'h1',
          sessionId: newId(),
          method: SystemMethod.Hello,
          params: helloParams(),
        }),
      ),
    );
    await nextMessage(ws1);

    const ws2 = await connect(port);
    ws2.send(
      encodeEnvelope(
        createRequest({
          id: 'h2',
          sessionId: newId(),
          method: SystemMethod.Hello,
          params: helloParams(),
        }),
      ),
    );
    const res2 = decodeEnvelope(await nextMessage(ws2)) as ResponseEnvelope;
    expect(res2.kind).toBe('res');
    expect(relay.sessions.list()).toHaveLength(2);
    ws1.close();
    ws2.close();
  });
});
