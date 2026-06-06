import {
  createError,
  createRequest,
  createResponse,
  decodeEnvelope,
  encodeEnvelope,
  type Envelope,
  ErrorCode,
  type HelloParams,
  type HelloResult,
  newId,
  PROTOCOL_VERSION,
  type RequestEnvelope,
  type ResponseEnvelope,
  SystemMethod,
} from '@figma-mcp-relay/shared';
import { describe, expect, it, vi } from 'vitest';

import { ACTIVITY_LIMIT, RelayClient, type WebSocketCtor } from '../../ui/relay/client.js';

interface FakeSocket {
  url: string;
  binaryType: BinaryType;
  readyState: number;
  onopen: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  send(data: ArrayBuffer | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}

interface FakeSocketControl extends FakeSocket {
  sent: Uint8Array[];
  fireOpen(): void;
  fireReceive(env: Envelope): void;
  fireServerClose(code?: number, reason?: string): void;
}

const buildFakeFactory = (
  behavior: (sock: FakeSocketControl, port: number) => void,
): { WS: WebSocketCtor; sockets: FakeSocketControl[] } => {
  const sockets: FakeSocketControl[] = [];

  class FakeWS implements FakeSocket {
    binaryType: BinaryType = 'blob';
    readyState = 0;
    onopen: ((ev: Event) => void) | null = null;
    onerror: ((ev: Event) => void) | null = null;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    onclose: ((ev: CloseEvent) => void) | null = null;
    sent: Uint8Array[] = [];

    constructor(public url: string) {
      const port = Number(new URL(url).port);
      const control: FakeSocketControl = Object.assign(this, {
        sent: this.sent,
        fireOpen: () => {
          this.readyState = 1;
          this.onopen?.(new Event('open'));
        },
        fireReceive: (env: Envelope) => {
          const bytes = encodeEnvelope(env);
          const ab = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer;
          this.onmessage?.({ data: ab } as MessageEvent);
        },
        fireServerClose: (code = 1000, reason = '') => {
          this.readyState = 3;
          this.onclose?.({ code, reason, wasClean: true } as CloseEvent);
        },
      });
      sockets.push(control);
      queueMicrotask(() => behavior(control, port));
    }

    send(data: ArrayBuffer | ArrayBufferView): void {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
      this.sent.push(bytes);
    }

    close(code = 1000, reason = ''): void {
      this.readyState = 3;
      this.onclose?.({ code, reason, wasClean: true } as CloseEvent);
    }
  }

  return { WS: FakeWS as unknown as WebSocketCtor, sockets };
};

const helloResult = (overrides: Partial<HelloResult> = {}): HelloResult => ({
  serverVersion: '1.0.0',
  protocolVersion: PROTOCOL_VERSION,
  sessionResumed: false,
  ...overrides,
});

describe('RelayClient', () => {
  it('connects, sends hello, and reaches connected state', async () => {
    const { WS, sockets } = buildFakeFactory(sock => {
      sock.fireOpen();
      const helloReq = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({ id: helloReq.id, sessionId: helloReq.sessionId, result: helloResult() }),
      );
    });

    const client = new RelayClient({ ports: [3055], clientVersion: '0.0.0', WS });
    const seen: string[] = [];
    client.subscribe(s => seen.push(s.status));

    await client.connect();

    expect(client.getState().status).toBe('connected');
    expect(client.getState().port).toBe(3055);
    expect(client.getState().sessionResumed).toBe(false);
    expect(seen).toContain('connecting');
    expect(seen).toContain('connected');

    const helloReq = decodeEnvelope(sockets[0]!.sent[0]!) as RequestEnvelope;
    const params = helloReq.params as HelloParams;
    expect(helloReq.method).toBe('$hello');
    expect(params.clientType).toBe('plugin');
    expect(params.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it('falls back to next port when first port refuses', async () => {
    const { WS, sockets } = buildFakeFactory((sock, port) => {
      if (port === 3055) {
        sock.fireServerClose(1006, 'connection refused');
        return;
      }
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({ id: req.id, sessionId: req.sessionId, result: helloResult() }),
      );
    });

    const client = new RelayClient({ ports: [3055, 3056], clientVersion: '0.0.0', WS });
    await client.connect();
    expect(client.getState().port).toBe(3056);
    expect(sockets).toHaveLength(2);
  });

  it('throws after exhausting all ports', async () => {
    const { WS } = buildFakeFactory(sock => sock.fireServerClose(1006, 'refused'));
    const client = new RelayClient({
      ports: [3055, 3056],
      clientVersion: '0.0.0',
      WS,
      log: vi.fn<(msg: string) => void>(),
    });
    await expect(client.connect()).rejects.toThrow(/no relay server found/);
    expect(client.getState().status).toBe('disconnected');
  });

  it('treats err envelope to hello as port failure and tries next', async () => {
    const { WS, sockets } = buildFakeFactory((sock, port) => {
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      if (port === 3055) {
        sock.fireReceive(
          createError({
            id: req.id,
            sessionId: req.sessionId,
            code: ErrorCode.InvalidParams,
            message: 'bad params',
          }),
        );
        return;
      }
      sock.fireReceive(
        createResponse({ id: req.id, sessionId: req.sessionId, result: helloResult() }),
      );
    });

    const client = new RelayClient({ ports: [3055, 3056], clientVersion: '0.0.0', WS });
    await client.connect();
    expect(client.getState().port).toBe(3056);
    expect(sockets).toHaveLength(2);
  });

  it('responds to server-initiated $ping with ok result', async () => {
    let liveSock: FakeSocketControl | undefined;
    const { WS } = buildFakeFactory(sock => {
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({ id: req.id, sessionId: req.sessionId, result: helloResult() }),
      );
      liveSock = sock;
    });

    const client = new RelayClient({ ports: [3055], clientVersion: '0.0.0', WS });
    await client.connect();

    const sentBeforePing = liveSock!.sent.length;
    liveSock!.fireReceive(
      createRequest({
        id: 'srv-ping-1',
        sessionId: client.sessionId,
        method: SystemMethod.Ping,
      }),
    );

    expect(liveSock!.sent.length).toBe(sentBeforePing + 1);
    const reply = decodeEnvelope(liveSock!.sent.at(-1)!) as ResponseEnvelope;
    expect(reply.kind).toBe('res');
    expect(reply.id).toBe('srv-ping-1');
    expect(reply.result).toEqual({ ok: true });
  });

  it('reconnects automatically after server closes the live socket', async () => {
    let attempt = 0;
    const { WS, sockets } = buildFakeFactory(sock => {
      attempt += 1;
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({
          id: req.id,
          sessionId: req.sessionId,
          result: helloResult({ sessionResumed: attempt > 1 }),
        }),
      );
    });

    const client = new RelayClient({
      ports: [3055],
      clientVersion: '0.0.0',
      WS,
      reconnectInitialDelayMs: 5,
    });
    const seen: string[] = [];
    client.subscribe(s => seen.push(s.status));

    await client.connect();
    expect(client.getState().status).toBe('connected');

    sockets[0]!.fireServerClose(1001, 'leader gone');

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(client.getState().status).toBe('connected');
    expect(client.getState().sessionResumed).toBe(true);
    expect(sockets.length).toBeGreaterThanOrEqual(2);
    expect(seen).toContain('reconnecting');

    await client.disconnect();
  });

  it('does not reconnect after explicit disconnect()', async () => {
    let attempt = 0;
    const { WS } = buildFakeFactory(sock => {
      attempt += 1;
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({ id: req.id, sessionId: req.sessionId, result: helloResult() }),
      );
    });

    const client = new RelayClient({
      ports: [3055],
      clientVersion: '0.0.0',
      WS,
      reconnectInitialDelayMs: 5,
    });
    await client.connect();
    await client.disconnect();
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(attempt).toBe(1);
    expect(client.getState().status).toBe('disconnected');
  });

  it('dispatches non-system req to registered tool handler and replies with res', async () => {
    let liveSock: FakeSocketControl | undefined;
    const { WS } = buildFakeFactory(sock => {
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({ id: req.id, sessionId: req.sessionId, result: helloResult() }),
      );
      liveSock = sock;
    });

    const handler = vi.fn<(method: string, params: unknown) => Promise<unknown>>(
      async (method, params) => ({ received: { method, params } }),
    );
    const client = new RelayClient({ ports: [3055], clientVersion: '0.0.0', WS });
    client.setToolHandler(handler);
    await client.connect();

    const sentBefore = liveSock!.sent.length;
    liveSock!.fireReceive(
      createRequest({
        id: 'tool-1',
        sessionId: client.sessionId,
        method: 'ping',
        params: { hello: 'world' },
      }),
    );

    await new Promise(resolve => setTimeout(resolve, 5));
    expect(handler).toHaveBeenCalledWith('ping', { hello: 'world' });
    expect(liveSock!.sent.length).toBe(sentBefore + 1);
    const reply = decodeEnvelope(liveSock!.sent.at(-1)!);
    expect(reply).toMatchObject({
      kind: 'res',
      id: 'tool-1',
      result: { received: { method: 'ping', params: { hello: 'world' } } },
    });
  });

  it('replies METHOD_NOT_FOUND when no tool handler is registered', async () => {
    let liveSock: FakeSocketControl | undefined;
    const { WS } = buildFakeFactory(sock => {
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({ id: req.id, sessionId: req.sessionId, result: helloResult() }),
      );
      liveSock = sock;
    });

    const client = new RelayClient({ ports: [3055], clientVersion: '0.0.0', WS });
    await client.connect();

    liveSock!.fireReceive(
      createRequest({ id: 'tool-2', sessionId: client.sessionId, method: 'ping' }),
    );

    await new Promise(resolve => setTimeout(resolve, 5));
    const reply = decodeEnvelope(liveSock!.sent.at(-1)!);
    expect(reply).toMatchObject({
      kind: 'err',
      id: 'tool-2',
      error: { code: ErrorCode.MethodNotFound },
    });
  });

  it('replies INTERNAL_ERROR when the tool handler throws', async () => {
    let liveSock: FakeSocketControl | undefined;
    const { WS } = buildFakeFactory(sock => {
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({ id: req.id, sessionId: req.sessionId, result: helloResult() }),
      );
      liveSock = sock;
    });

    const client = new RelayClient({ ports: [3055], clientVersion: '0.0.0', WS });
    client.setToolHandler(async () => {
      throw new Error('sandbox blew up');
    });
    await client.connect();

    liveSock!.fireReceive(
      createRequest({ id: 'tool-3', sessionId: client.sessionId, method: 'ping' }),
    );

    await new Promise(resolve => setTimeout(resolve, 5));
    const reply = decodeEnvelope(liveSock!.sent.at(-1)!);
    expect(reply).toMatchObject({
      kind: 'err',
      error: {
        code: ErrorCode.Internal,
        message: expect.stringContaining('sandbox blew up'),
      },
    });
  });

  const connectWithLiveSocket = async (
    handler?: (method: string, params: unknown) => Promise<unknown>,
  ): Promise<{ client: RelayClient; live: FakeSocketControl }> => {
    let liveSock: FakeSocketControl | undefined;
    const { WS } = buildFakeFactory(sock => {
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({ id: req.id, sessionId: req.sessionId, result: helloResult() }),
      );
      liveSock = sock;
    });
    const client = new RelayClient({ ports: [3055], clientVersion: '0.0.0', WS });
    if (handler !== undefined) client.setToolHandler(handler);
    await client.connect();
    return { client, live: liveSock! };
  };

  it('records a successful tool call in activity with ok status and duration', async () => {
    const { client, live } = await connectWithLiveSocket(async () => ({ ok: true }));
    live.fireReceive(
      createRequest({ id: 't-1', sessionId: client.sessionId, method: 'get_pages' }),
    );
    await new Promise(resolve => setTimeout(resolve, 5));

    const s = client.getState();
    expect(s.totalCalls).toBe(1);
    expect(s.activity).toHaveLength(1);
    expect(s.activity[0]).toMatchObject({ id: 't-1', method: 'get_pages', status: 'ok' });
    expect(s.activity[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records a throwing tool call as an error with its message', async () => {
    const { client, live } = await connectWithLiveSocket(async () => {
      throw new Error('boom');
    });
    live.fireReceive(createRequest({ id: 't-2', sessionId: client.sessionId, method: 'get_node' }));
    await new Promise(resolve => setTimeout(resolve, 5));

    expect(client.getState().activity[0]).toMatchObject({
      id: 't-2',
      method: 'get_node',
      status: 'error',
      error: expect.stringContaining('boom'),
    });
  });

  it('records an error entry when no tool handler is registered', async () => {
    const { client, live } = await connectWithLiveSocket();
    live.fireReceive(
      createRequest({ id: 't-3', sessionId: client.sessionId, method: 'get_pages' }),
    );
    await new Promise(resolve => setTimeout(resolve, 5));

    expect(client.getState().activity[0]).toMatchObject({ id: 't-3', status: 'error' });
  });

  it('keeps activity most-recent-first and capped at ACTIVITY_LIMIT', async () => {
    const { client, live } = await connectWithLiveSocket(async () => ({ ok: true }));
    const total = ACTIVITY_LIMIT + 5;
    for (let i = 0; i < total; i += 1) {
      live.fireReceive(
        createRequest({ id: `t-${i}`, sessionId: client.sessionId, method: `m_${i}` }),
      );
    }
    await new Promise(resolve => setTimeout(resolve, 20));

    const s = client.getState();
    expect(s.totalCalls).toBe(total);
    expect(s.activity).toHaveLength(ACTIVITY_LIMIT);
    expect(s.activity[0]?.method).toBe(`m_${total - 1}`);
  });

  it('tracks connectedAt and bumps reconnectCount on auto-reconnect', async () => {
    let attempt = 0;
    const { WS, sockets } = buildFakeFactory(sock => {
      attempt += 1;
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({
          id: req.id,
          sessionId: req.sessionId,
          result: helloResult({ sessionResumed: attempt > 1 }),
        }),
      );
    });
    const client = new RelayClient({
      ports: [3055],
      clientVersion: '0.0.0',
      WS,
      reconnectInitialDelayMs: 5,
    });
    await client.connect();
    expect(client.getState().connectedAt).toBeTypeOf('number');
    expect(client.getState().reconnectCount).toBe(0);

    sockets[0]!.fireServerClose(1001, 'leader gone');
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(client.getState().status).toBe('connected');
    expect(client.getState().reconnectCount).toBe(1);
    expect(client.getState().connectedAt).toBeTypeOf('number');
    await client.disconnect();
    expect(client.getState().connectedAt).toBeNull();
  });

  it('reuses sessionId across reconnect attempts', async () => {
    const sessionId = newId();
    const { WS, sockets } = buildFakeFactory(sock => {
      sock.fireOpen();
      const req = decodeEnvelope(sock.sent[0]!) as RequestEnvelope;
      sock.fireReceive(
        createResponse({
          id: req.id,
          sessionId: req.sessionId,
          result: helloResult({ sessionResumed: true }),
        }),
      );
    });

    const client = new RelayClient({
      ports: [3055],
      clientVersion: '0.0.0',
      sessionId,
      WS,
    });
    await client.connect();
    const helloReq = decodeEnvelope(sockets[0]!.sent[0]!) as RequestEnvelope;
    expect(helloReq.sessionId).toBe(sessionId);
    expect(client.getState().sessionResumed).toBe(true);
  });
});
