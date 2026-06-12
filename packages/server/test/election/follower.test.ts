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
  SystemMethod,
} from '@figwright/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { Follower } from '../../src/election/follower.js';
import { attachLeaderEndpoints } from '../../src/election/leader-endpoints.js';
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

const startLeader = async (): Promise<Bound> => {
  const http = createServer();
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', () => resolve()));
  const port = (http.address() as AddressInfo).port;
  const relay = new Relay({ serverVersion: 'test-1.0.0', server: http });
  const detach = attachLeaderEndpoints(http, { relay, serverVersion: 'test-1.0.0' });
  const b: Bound = { http, relay, port, detach, plugins: [] };
  all.push(b);
  return b;
};

const startLeaderWithTimeout = async (rpcTimeoutMs: number): Promise<Bound> => {
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
): Promise<void> => {
  const ws = new WebSocket(`ws://127.0.0.1:${b.port}`);
  ws.binaryType = 'arraybuffer';
  await new Promise<void>(resolve => ws.once('open', () => resolve()));

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
  await helloReceived;
  b.plugins.push(ws);
};

describe('Follower HTTP client', () => {
  it('ping returns true when leader is up', async () => {
    const b = await startLeader();
    const f = new Follower({ leaderUrl: `http://127.0.0.1:${b.port}` });
    expect(await f.ping()).toBe(true);
  });

  it('ping returns false for unreachable leader', async () => {
    const f = new Follower({
      leaderUrl: 'http://127.0.0.1:1',
      pingTimeoutMs: 200,
    });
    expect(await f.ping()).toBe(false);
  });

  it('sendRpc round-trips through leader to plugin', async () => {
    const b = await startLeader();
    await attachFakePlugin(b, async (method, params) => {
      expect(method).toBe('get_doc');
      expect(params).toEqual({ depth: 2 });
      return { name: 'My Doc', pages: 3 };
    });

    const f = new Follower({ leaderUrl: `http://127.0.0.1:${b.port}` });
    const resp = await f.sendRpc('get_doc', { depth: 2 }, 'r-42');
    if (resp.kind !== 'ok') throw new Error(`expected ok, got ${resp.kind}`);
    expect(resp.requestId).toBe('r-42');
    expect(resp.result).toEqual({ name: 'My Doc', pages: 3 });
  });

  it('sendRpc surfaces leader-side err response', async () => {
    const b = await startLeaderWithTimeout(50);
    const f = new Follower({ leaderUrl: `http://127.0.0.1:${b.port}` });
    const resp = await f.sendRpc('whatever', undefined, 'r-no-plugin');
    if (resp.kind !== 'err') throw new Error(`expected err, got ${resp.kind}`);
    expect(resp.code).toBe(ErrorCode.Timeout);
    expect(resp.requestId).toBe('r-no-plugin');
  });

  it('sendRpc returns Internal err when transport fails', async () => {
    const f = new Follower({
      leaderUrl: 'http://127.0.0.1:1',
      rpcTimeoutMs: 200,
    });
    const resp = await f.sendRpc('x', undefined, 'r-dead');
    if (resp.kind !== 'err') throw new Error(`expected err, got ${resp.kind}`);
    expect(resp.code).toBe(ErrorCode.Internal);
    expect(resp.requestId).toBe('r-dead');
  });

  it('resolveActiveSession reads the leader-picked session id', async () => {
    const b = await startLeader();
    const f = new Follower({ leaderUrl: `http://127.0.0.1:${b.port}` });
    // No plugin yet → undefined, caller falls back to unpinned routing.
    expect(await f.resolveActiveSession()).toBeUndefined();

    await attachFakePlugin(b, async () => ({ noop: true }));
    expect(await f.resolveActiveSession()).toBe(b.relay.pickActiveSessionId());
  });

  it('resolveActiveSession returns undefined when the leader is unreachable', async () => {
    const f = new Follower({ leaderUrl: 'http://127.0.0.1:1', pingTimeoutMs: 200 });
    expect(await f.resolveActiveSession()).toBeUndefined();
  });

  it('sendRpc threads sessionId so the leader pins the call', async () => {
    const b = await startLeader();
    await attachFakePlugin(b, async () => ({ ok: true }));
    const sid = b.relay.pickActiveSessionId();
    const f = new Follower({ leaderUrl: `http://127.0.0.1:${b.port}` });

    const ok = await f.sendRpc('get_design_context', {}, 'r-pin', sid);
    expect(ok.kind).toBe('ok');

    const bad = await f.sendRpc('get_design_context', {}, 'r-ghost', 'ghost-session');
    if (bad.kind !== 'err') throw new Error(`expected err, got ${bad.kind}`);
    expect(bad.code).toBe(ErrorCode.PluginDisconnected);
  });
});
