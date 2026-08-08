import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  createEvent,
  createRequest,
  createResponse,
  decodeEnvelope,
  encodeEnvelope,
  type Envelope,
  ErrorCode,
  type ErrorEnvelope,
  type HelloParams,
  type HelloResult,
  MIN_PLUGIN_VERSION,
  newId,
  PROTOCOL_VERSION,
  type ResponseEnvelope,
  SystemMethod,
} from '@figwright/shared';
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
    serverVersion: '1.0.0',
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
  clientVersion: MIN_PLUGIN_VERSION,
  protocolVersion: PROTOCOL_VERSION,
  ...overrides,
});

describe('Relay upgrade gating', () => {
  it('refuses a WebSocket upgrade from a web page', async () => {
    const b = await startRelay();
    const ws = new WebSocket(`ws://127.0.0.1:${b.port}`, {
      headers: { origin: 'https://evil.example' },
    });

    const status = await new Promise<number>((resolve, reject) => {
      ws.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.once('open', () => reject(new Error('upgrade should have been refused')));
      ws.once('error', () => resolve(0));
    });
    expect(status).toBe(403);
    expect(b.relay.sessions.connected()).toHaveLength(0);
  });

  it('refuses an upgrade addressed to a rebound domain', async () => {
    const b = await startRelay();
    const ws = new WebSocket(`ws://127.0.0.1:${b.port}`, {
      headers: { host: `evil.example:${b.port}` },
    });

    const status = await new Promise<number>((resolve, reject) => {
      ws.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.once('open', () => reject(new Error('upgrade should have been refused')));
      ws.once('error', () => resolve(0));
    });
    expect(status).toBe(403);
  });

  it('admits the plugin, whose sandboxed origin is the literal "null"', async () => {
    const b = await startRelay();
    const ws = new WebSocket(`ws://127.0.0.1:${b.port}`, { headers: { origin: 'null' } });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });
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
    expect(result.serverVersion).toBe('1.0.0');
    expect(result.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(result.sessionResumed).toBe(false);
    ws.close();
  });

  it('rejects non-hello first message', async () => {
    const { port } = await startRelay();
    const ws = await connect(port);
    ws.send(
      encodeEnvelope(createRequest({ id: 'x', sessionId: newId(), method: 'something_else' })),
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

  it('rejects a $hello with a mismatched protocolVersion and a clear ProtocolMismatch error', async () => {
    const { port } = await startRelay();
    const ws = await connect(port);
    ws.send(
      encodeEnvelope(
        createRequest({
          id: 'h1',
          sessionId: newId(),
          method: SystemMethod.Hello,
          params: helloParams({ protocolVersion: '9.9.9' }),
        }),
      ),
    );
    const res = decodeEnvelope(await nextMessage(ws)) as ErrorEnvelope;
    expect(res.kind).toBe('err');
    expect(res.error.code).toBe(ErrorCode.ProtocolMismatch);
    expect(res.error.message).toMatch(/protocol mismatch/i);
    await new Promise(r => ws.once('close', r));
  });

  it('serves a plugin below the floor, and marks its session as skewed', async () => {
    // Refusing was built, measured against a real v0.3.0 plugin, and abandoned: the "stop retrying"
    // half can only live in a plugin new enough never to be refused, so an old one re-offered the
    // rejected handshake ~7x a second forever. The server serves it and says so instead.
    const b = await startRelay();
    const ws = await connect(b.port);
    ws.send(
      encodeEnvelope(
        createRequest({
          id: 'h1',
          sessionId: newId(),
          method: SystemMethod.Hello,
          params: helloParams({ clientVersion: '0.0.1' }),
        }),
      ),
    );
    const res = decodeEnvelope(await nextMessage(ws)) as ResponseEnvelope;

    expect(res.kind).toBe('res');
    expect(b.relay.sessions.connected()).toHaveLength(1);
    // Told on the handshake, so a plugin new enough to render it can, before any call is made.
    const result = res.result as HelloResult;
    expect(result.skewNotice).toMatch(/older than this server/i);
    expect(result.skewNotice).toMatch(/silently ignored/i);
    expect(result.skewNotice).toMatch(/Update the plugin/);
    // And available per session, which is what a call attributes its result to.
    const [session] = b.relay.sessions.connected();
    expect(b.relay.skewNotice(session?.id)).toMatch(/older than this server/i);
    ws.close();
  });

  it('serves a plugin whose version cannot be identified, and warns about it', async () => {
    const b = await startRelay();
    const ws = await connect(b.port);
    ws.send(
      encodeEnvelope(
        createRequest({
          id: 'h1',
          sessionId: newId(),
          method: SystemMethod.Hello,
          params: helloParams({ clientVersion: 'nightly' }),
        }),
      ),
    );
    const res = decodeEnvelope(await nextMessage(ws)) as ResponseEnvelope;

    expect(res.kind).toBe('res');
    expect((res.result as HelloResult).skewNotice).toMatch(/older than this server/i);
    ws.close();
  });

  it('attributes each concurrent call to the plugin that answered it', async () => {
    // Two Figma files open on different builds, calls in flight against both. Attribution has to
    // follow the request, not the relay's current routing: an implementation that asked "who is
    // most-active?" would give both calls the same answer and mislabel one of them.
    const b = await startRelay();
    const oldPlugin = await connect(b.port);
    const staleId = newId();
    oldPlugin.send(
      encodeEnvelope(
        createRequest({
          id: 'h1',
          sessionId: staleId,
          method: SystemMethod.Hello,
          params: helloParams({ clientVersion: '0.0.1' }),
        }),
      ),
    );
    await nextMessage(oldPlugin);

    const newPlugin = await connect(b.port);
    const currentId = newId();
    newPlugin.send(
      encodeEnvelope(
        createRequest({
          id: 'h2',
          sessionId: currentId,
          method: SystemMethod.Hello,
          params: helloParams(),
        }),
      ),
    );
    await nextMessage(newPlugin);

    // Each plugin answers whatever it is asked, back to back.
    const answer = (ws: WebSocket, sessionId: string): void => {
      ws.on('message', data => {
        const env = decodeEnvelope(data as ArrayBuffer);
        if (env.kind === 'req' && env.method === 'get_document') {
          ws.send(encodeEnvelope(createResponse({ id: env.id, sessionId, result: { ok: true } })));
        }
      });
    };
    answer(oldPlugin, staleId);
    answer(newPlugin, currentId);

    const seen = new Map<string, string | null>();
    await Promise.all([
      b.relay.sendRequest('get_document', {}, 5000, staleId, served =>
        seen.set('old', b.relay.skewNotice(served)),
      ),
      b.relay.sendRequest('get_document', {}, 5000, currentId, served =>
        seen.set('new', b.relay.skewNotice(served)),
      ),
    ]);

    expect(seen.get('old')).toMatch(/older than this server/i);
    expect(seen.get('new')).toBeNull();
  });

  it('explains the skew once, then keeps saying it in one line', async () => {
    // The full text is ~120 tokens and the plugin cannot change under a session, so restating it on
    // every call of a fifty-call run spends thousands of tokens on one unchanging fact — and
    // identical text every turn is what teaches a model to skim past it.
    const b = await startRelay();
    const ws = await connect(b.port);
    const sessionId = newId();
    ws.send(
      encodeEnvelope(
        createRequest({
          id: 'h1',
          sessionId,
          method: SystemMethod.Hello,
          params: helloParams({ clientVersion: '0.0.1' }),
        }),
      ),
    );
    await nextMessage(ws);

    const first = b.relay.skewNotice(sessionId);
    const second = b.relay.skewNotice(sessionId);
    const third = b.relay.skewNotice(sessionId);

    expect(first).toMatch(/releases\/latest/);
    // Still says what it is and what it means — a caller seeing only this is not misinformed.
    expect(second).toMatch(/older than this server/i);
    expect(second).toMatch(/unverified/i);
    expect(second).not.toMatch(/releases\/latest/);
    expect(second?.length ?? 0).toBeLessThan((first?.length ?? 0) / 2);
    expect(third).toBe(second);
    ws.close();
  });

  it('says nothing about skew for a current plugin', async () => {
    // The warning only means anything if it stays quiet when there is nothing to warn about.
    const b = await startRelay();
    const ws = await connect(b.port);
    ws.send(
      encodeEnvelope(
        createRequest({
          id: 'h1',
          sessionId: newId(),
          method: SystemMethod.Hello,
          params: helloParams(),
        }),
      ),
    );
    const res = decodeEnvelope(await nextMessage(ws)) as ResponseEnvelope;

    expect((res.result as HelloResult).skewNotice).toBeUndefined();
    const [session] = b.relay.sessions.connected();
    expect(b.relay.skewNotice(session?.id)).toBeNull();
    ws.close();
  });

  it('admits a plugin newer than the server without warning', async () => {
    // Skew this way is safe: a newer plugin understands every argument an older server sends.
    const b = await startRelay();
    const ws = await connect(b.port);
    ws.send(
      encodeEnvelope(
        createRequest({
          id: 'h1',
          sessionId: newId(),
          method: SystemMethod.Hello,
          params: helloParams({ clientVersion: '99.0.0' }),
        }),
      ),
    );
    const res = decodeEnvelope(await nextMessage(ws)) as ResponseEnvelope;

    expect(res.kind).toBe('res');
    expect((res.result as HelloResult).skewNotice).toBeUndefined();
    ws.close();
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
    ws.send(encodeEnvelope(createRequest({ id: 'p', sessionId, method: SystemMethod.Ping })));
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

    // Assert only the contract: a plugin that misses maxMisses heartbeats gets closed with 1001.
    // We deliberately do NOT assert "a ping was sent first" — HeartbeatMonitor.tick() closes
    // straight away when the first timer callback already spans >= maxMisses intervals (real under
    // CI timer jitter), so a preceding ping is not a guarantee the implementation makes. Asserting
    // it made this test flaky; the ping-is-sent behaviour is covered deterministically below.
    const closeCode = await new Promise<number>(resolve => {
      ws.once('close', code => resolve(code));
    });
    expect(closeCode).toBe(1001);
  });

  it('sends heartbeat pings to an idle plugin', async () => {
    // maxMisses is high so the socket never closes during the test — this isolates "the server pings
    // an idle plugin" from the close-timing race above. The collector is registered before the first
    // await after hello, so no ping can slip through an unlistened gap.
    const { port } = await startRelay({ heartbeatIntervalMs: 20, heartbeatMaxMisses: 1000 });
    const ws = await connect(port);
    const sessionId = newId();
    ws.send(
      encodeEnvelope(
        createRequest({ id: 'h', sessionId, method: SystemMethod.Hello, params: helloParams() }),
      ),
    );
    await nextMessage(ws);

    const firstPing = await new Promise<Envelope>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no heartbeat ping within 2s')), 2000);
      ws.on('message', d => {
        try {
          const env = decodeEnvelope(d as ArrayBuffer);
          if (env.kind === 'req' && env.method === SystemMethod.Ping) {
            clearTimeout(timer);
            resolve(env);
          }
        } catch {
          /* ignore non-ping frames */
        }
      });
    });
    expect(firstPing).toMatchObject({ kind: 'req', method: SystemMethod.Ping });
    ws.close();
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
        ws.send(encodeEnvelope(createResponse({ id: env.id, sessionId, result: { ok: true } })));
      }
    });

    await new Promise(r => setTimeout(r, 300));
    expect(closed).toBe(false);
    ws.close();
  });

  it('defers the heartbeat timeout while a request is in-flight (busy ≠ dead)', async () => {
    const { relay, port } = await startRelay({ heartbeatIntervalMs: 30, heartbeatMaxMisses: 2 });
    const ws = await connect(port);
    const sessionId = newId();
    ws.send(
      encodeEnvelope(
        createRequest({ id: 'h', sessionId, method: SystemMethod.Hello, params: helloParams() }),
      ),
    );
    await nextMessage(ws);

    // Dispatch a request pinned to this session and never reply — it stays in-flight. The plugin also
    // never answers pings, simulating a thread stuck encoding a huge reply. The socket must stay open.
    const inflight = relay.sendRequest('get_screenshot', { nodeIds: ['1:2'] }, 60_000, sessionId);
    inflight.catch(() => {}); // relay.stop() in afterEach rejects pending; swallow

    let closed = false;
    ws.once('close', () => {
      closed = true;
    });

    await new Promise(r => setTimeout(r, 300)); // several heartbeat windows
    expect(closed).toBe(false);
    expect(relay.heartbeatDeferralCount()).toBeGreaterThan(0);
    ws.close();
  });

  it('resumes closing the socket once the in-flight request resolves', async () => {
    const { relay, port } = await startRelay({ heartbeatIntervalMs: 30, heartbeatMaxMisses: 2 });
    const ws = await connect(port);
    const sessionId = newId();
    ws.send(
      encodeEnvelope(
        createRequest({ id: 'h', sessionId, method: SystemMethod.Hello, params: helloParams() }),
      ),
    );
    await nextMessage(ws);

    // Reply to the dispatched tool request (clears in-flight) but never answer pings afterward.
    ws.on('message', d => {
      const env = decodeEnvelope(d as ArrayBuffer);
      if (env.kind === 'req' && env.method !== SystemMethod.Ping) {
        ws.send(encodeEnvelope(createResponse({ id: env.id, sessionId, result: { ok: true } })));
      }
    });

    await relay.sendRequest('get_screenshot', { nodeIds: ['1:2'] }, 60_000, sessionId);

    // In-flight is now empty, so the next missed-heartbeat window must close the socket as before.
    const closeCode = await new Promise<number>(resolve => ws.once('close', code => resolve(code)));
    expect(closeCode).toBe(1001);
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

  it('routes to the most-recently-active session, not the oldest', async () => {
    const { port, relay } = await startRelay();
    const sidA = newId();
    const sidB = newId();

    const wsA = await connect(port);
    wsA.send(
      encodeEnvelope(
        createRequest({
          id: 'hA',
          sessionId: sidA,
          method: SystemMethod.Hello,
          params: helloParams(),
        }),
      ),
    );
    await nextMessage(wsA);

    // Ensure clock advances so timestamps strictly differ; Date.now()'s ms granularity makes
    // back-to-back registers risk a tie otherwise.
    await new Promise(r => setTimeout(r, 5));

    const wsB = await connect(port);
    wsB.send(
      encodeEnvelope(
        createRequest({
          id: 'hB',
          sessionId: sidB,
          method: SystemMethod.Hello,
          params: helloParams(),
        }),
      ),
    );
    await nextMessage(wsB);

    // B connected later → its fresh `lastActivityAt` wins routing.
    expect(relay.pickActiveSession()?.id).toBe(sidB);

    // Now A's plugin pushes an explicit $activity event (the signal sandbox emits when the user
    // selects/changes page). This bumps A's activity past B's. A heartbeat reply or tool response
    // intentionally would NOT — only $activity does, so the two sessions don't race to a coin
    // flip every heartbeat interval.
    await new Promise(r => setTimeout(r, 5));
    wsA.send(
      encodeEnvelope(
        createEvent({
          id: 'a1',
          sessionId: sidA,
          method: SystemMethod.Activity,
          params: { fileName: 'Project A', pageId: 'p-1', pageName: 'Cover' },
        }),
      ),
    );
    // No reply expected for an event; let the server process it.
    await new Promise(r => setTimeout(r, 20));

    expect(relay.pickActiveSession()?.id).toBe(sidA);
    // The activity event also seeds the session with its file/page label for ping observability.
    expect(relay.pickActiveSession()?.fileName).toBe('Project A');
    expect(relay.pickActiveSession()?.pageName).toBe('Cover');

    wsA.close();
    wsB.close();
  });

  it('a reconnect (resumed session) does NOT bump routing — only a fresh session does', async () => {
    const { port, relay } = await startRelay();
    const sidA = newId();
    const sidB = newId();

    // A connects first.
    const wsA = await connect(port);
    wsA.send(
      encodeEnvelope(
        createRequest({
          id: 'hA',
          sessionId: sidA,
          method: SystemMethod.Hello,
          params: helloParams(),
        }),
      ),
    );
    await nextMessage(wsA);

    await new Promise(r => setTimeout(r, 5));

    // B connects later → fresh session wins routing.
    const wsB = await connect(port);
    wsB.send(
      encodeEnvelope(
        createRequest({
          id: 'hB',
          sessionId: sidB,
          method: SystemMethod.Hello,
          params: helloParams(),
        }),
      ),
    );
    await nextMessage(wsB);
    expect(relay.pickActiveSession()?.id).toBe(sidB);

    // A's websocket flaps: drop and reconnect with the SAME sessionId within grace (what a
    // backgrounded, throttled plugin does when it misses a heartbeat). This must NOT steal routing
    // back to A — a reconnect is not user interaction.
    await new Promise(r => setTimeout(r, 5));
    wsA.close();
    await new Promise(r => setTimeout(r, 10));
    const wsA2 = await connect(port);
    wsA2.send(
      encodeEnvelope(
        createRequest({
          id: 'hA2',
          sessionId: sidA,
          method: SystemMethod.Hello,
          params: helloParams(),
        }),
      ),
    );
    const resA2 = decodeEnvelope(await nextMessage(wsA2)) as ResponseEnvelope;
    expect((resA2.result as { sessionResumed?: boolean }).sessionResumed).toBe(true);

    // Routing still on B — the reconnect did not bump A's lastActivityAt.
    expect(relay.pickActiveSession()?.id).toBe(sidB);

    wsA2.close();
    wsB.close();
  });
});

describe('Relay session pinning', () => {
  const delay = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

  const hello = async (ws: WebSocket, sid: string): Promise<void> => {
    ws.send(
      encodeEnvelope(
        createRequest({
          id: newId(),
          sessionId: sid,
          method: SystemMethod.Hello,
          params: helloParams(),
        }),
      ),
    );
    await nextMessage(ws);
  };

  // Read the id of the i-th collected request, asserting it exists (keeps the type checker happy
  // under noUncheckedIndexedAccess and fails loudly if the request never arrived).
  const reqId = (reqs: Envelope[], i: number): string => {
    const env = reqs[i];
    if (env === undefined) throw new Error(`expected request #${i}, collected ${reqs.length}`);
    return env.id;
  };

  // Collect dispatched tool requests (ignoring server $ping) so a test can assert which plugin
  // socket a sendRequest landed on.
  const collectRequests = (ws: WebSocket): Envelope[] => {
    const reqs: Envelope[] = [];
    ws.on('message', data => {
      const env = decodeEnvelope(data as ArrayBuffer);
      if (env.kind === 'req' && env.method !== SystemMethod.Ping) reqs.push(env);
    });
    return reqs;
  };

  // Set up two connected sessions A and B, with B most-recently-active so unpinned routing prefers
  // it. Returns sockets, ids, and per-socket request collectors.
  const twoSessions = async (
    relay: Relay,
    port: number,
  ): Promise<{
    wsA: WebSocket;
    wsB: WebSocket;
    sidA: string;
    sidB: string;
    reqsA: Envelope[];
    reqsB: Envelope[];
  }> => {
    const sidA = newId();
    const sidB = newId();
    const wsA = await connect(port);
    await hello(wsA, sidA);
    await delay(5);
    const wsB = await connect(port);
    await hello(wsB, sidB);
    // B is most-active.
    expect(relay.pickActiveSessionId()).toBe(sidB);
    return { wsA, wsB, sidA, sidB, reqsA: collectRequests(wsA), reqsB: collectRequests(wsB) };
  };

  it('routes a pinned request to its session even when another is more active', async () => {
    const { port, relay } = await startRelay();
    const { wsA, wsB, sidA, reqsA, reqsB } = await twoSessions(relay, port);

    // Pin to A although B is the most-active session.
    const p = relay.sendRequest('get_design_context', { a: 1 }, 5_000, sidA);
    await delay(20);
    expect(reqsB).toHaveLength(0);
    expect(reqsA).toHaveLength(1);

    // Reply from A so the promise resolves.
    wsA.send(
      encodeEnvelope(createResponse({ id: reqId(reqsA, 0), sessionId: sidA, result: { ok: 'A' } })),
    );
    await expect(p).resolves.toEqual({ ok: 'A' });
    wsA.close();
    wsB.close();
  });

  it('keeps a pinned group together when activity flips mid-flight', async () => {
    const { port, relay } = await startRelay();
    const { wsA, wsB, sidA, sidB, reqsA, reqsB } = await twoSessions(relay, port);

    // First pinned sub-call goes to A.
    const p1 = relay.sendRequest('get_design_context', {}, 5_000, sidA);
    await delay(20);
    expect(reqsA).toHaveLength(1);
    wsA.send(
      encodeEnvelope(createResponse({ id: reqId(reqsA, 0), sessionId: sidA, result: { n: 1 } })),
    );
    await p1;

    // B now becomes the most-active session (user clicks in the other file).
    wsB.send(
      encodeEnvelope(
        createEvent({
          id: newId(),
          sessionId: sidB,
          method: SystemMethod.Activity,
          params: { fileName: 'B', pageId: 'p', pageName: 'P' },
        }),
      ),
    );
    await delay(20);
    expect(relay.pickActiveSessionId()).toBe(sidB);

    // Second pinned sub-call must STILL go to A, not the now-most-active B.
    const p2 = relay.sendRequest('get_local_components', {}, 5_000, sidA);
    await delay(20);
    expect(reqsB).toHaveLength(0);
    expect(reqsA).toHaveLength(2);
    wsA.send(
      encodeEnvelope(createResponse({ id: reqId(reqsA, 1), sessionId: sidA, result: { n: 2 } })),
    );
    await expect(p2).resolves.toEqual({ n: 2 });
    wsA.close();
    wsB.close();
  });

  it('rejects a request pinned to a session that is not connected', async () => {
    const { port, relay } = await startRelay();
    const wsA = await connect(port);
    await hello(wsA, newId());

    await expect(
      relay.sendRequest('get_design_context', {}, 5_000, 'ghost-session'),
    ).rejects.toThrow(/pinned session not connected/);
    wsA.close();
  });
});
