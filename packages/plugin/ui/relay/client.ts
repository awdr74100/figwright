import {
  type ActivityParams,
  createError,
  createEvent,
  createRequest,
  createResponse,
  decodeEnvelope,
  encodeEnvelope,
  type Envelope,
  ErrorCode,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_MAX_MISSES,
  HeartbeatMonitor,
  type HelloParams,
  type HelloResult,
  newId,
  PROTOCOL_VERSION,
  SystemMethod,
} from '@figwright/shared';

import { type ActivityPayload, summarizePayload } from './payload.js';

export type RelayStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export type ToolHandler = (method: string, params: unknown) => Promise<unknown>;

/** Most-recent tool calls kept in memory for the UI Activity tab. */
export const ACTIVITY_LIMIT = 30;

export type ActivityStatus = 'pending' | 'ok' | 'error';

export interface ActivityEntry {
  /** Request id of the originating tool call. */
  id: string;
  method: string;
  startedAt: number;
  status: ActivityStatus;
  durationMs?: number;
  error?: string;
  /** Snapshot of the call's request params (see payload.ts) — what we were asked to do. */
  request?: ActivityPayload;
  /** For a successful call, a snapshot of the result sent back to the LLM (see payload.ts). */
  payload?: ActivityPayload;
}

export interface RelayClientState {
  status: RelayStatus;
  port: number | null;
  sessionResumed: boolean;
  /** Server version from the hello handshake, or null until connected (for diagnostics). */
  serverVersion: string | null;
  lastError: string | null;
  /** Epoch ms of the current connection, or null while not connected (for uptime). */
  connectedAt: number | null;
  /** How many times the live socket dropped and was re-established. */
  reconnectCount: number;
  /** Total tool calls received this session (not capped by ACTIVITY_LIMIT). */
  totalCalls: number;
  /** Recent tool calls, most-recent-first, capped at ACTIVITY_LIMIT. */
  activity: readonly ActivityEntry[];
}

export type WebSocketCtor = new (url: string) => WebSocket;

export interface RelayClientOptions {
  ports: readonly number[];
  clientVersion: string;
  sessionId?: string;
  host?: string;
  WS?: WebSocketCtor;
  log?: (msg: string) => void;
  helloTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatMaxMisses?: number;
  reconnectInitialDelayMs?: number;
  reconnectMaxDelayMs?: number;
}

const DEFAULT_HELLO_TIMEOUT_MS = 2_000;
const DEFAULT_RECONNECT_INITIAL_DELAY_MS = 250;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 5_000;

export class RelayClient {
  readonly sessionId: string;
  private readonly opts: Required<Omit<RelayClientOptions, 'sessionId'>>;
  private state: RelayClientState = {
    status: 'idle',
    port: null,
    sessionResumed: false,
    serverVersion: null,
    lastError: null,
    connectedAt: null,
    reconnectCount: 0,
    totalCalls: 0,
    activity: [],
  };
  private socket: WebSocket | null = null;
  private heartbeat: HeartbeatMonitor | null = null;
  private listeners = new Set<(s: RelayClientState) => void>();
  private stopped = false;
  private reconnecting = false;
  private toolHandler: ToolHandler | null = null;

  constructor(opts: RelayClientOptions) {
    this.sessionId = opts.sessionId ?? newId();
    this.opts = {
      ports: opts.ports,
      clientVersion: opts.clientVersion,
      host: opts.host ?? '127.0.0.1',
      WS: opts.WS ?? (globalThis as { WebSocket?: WebSocketCtor }).WebSocket!,
      log: opts.log ?? ((): void => {}),
      helloTimeoutMs: opts.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS,
      heartbeatIntervalMs: opts.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS,
      heartbeatMaxMisses: opts.heartbeatMaxMisses ?? HEARTBEAT_MAX_MISSES,
      reconnectInitialDelayMs: opts.reconnectInitialDelayMs ?? DEFAULT_RECONNECT_INITIAL_DELAY_MS,
      reconnectMaxDelayMs: opts.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS,
    };
  }

  getState(): RelayClientState {
    return this.state;
  }

  setToolHandler(handler: ToolHandler | null): void {
    this.toolHandler = handler;
  }

  /**
   * Tell the leader that this session just saw user interaction (sandbox sent a context event for
   * selection/page change). The leader uses this to pick the most-recently-active session when more
   * than one plugin is connected. `params` also carry file + page identity so the leader can report
   * "routed to file X, page Y" back through `ping` — the routing decision and the user-facing label
   * both live on the same signal. Silently no-ops while disconnected.
   */
  notifyActivity(params: ActivityParams): void {
    if (this.socket === null || this.state.status !== 'connected') return;
    this.socket.send(
      encodeEnvelope(
        createEvent({
          id: newId(),
          sessionId: this.sessionId,
          method: SystemMethod.Activity,
          params,
        }),
      ),
    );
  }

  subscribe(fn: (s: RelayClientState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => {
      this.listeners.delete(fn);
    };
  }

  async connect(): Promise<void> {
    if (this.state.status === 'connecting' || this.state.status === 'connected') return;
    this.stopped = false;
    this.update({ status: 'connecting', lastError: null });

    for (const port of this.opts.ports) {
      if (this.stopped) return;
      try {
        // eslint-disable-next-line no-await-in-loop -- intentional sequential port probe
        await this.attemptPort(port);
        return;
      } catch (err) {
        this.opts.log(`[relay-client] port ${port} failed: ${(err as Error).message}`);
      }
    }

    this.update({
      status: 'disconnected',
      port: null,
      lastError: `no relay server found on ports [${this.opts.ports.join(', ')}]`,
    });
    throw new Error(this.state.lastError ?? 'connect failed');
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    this.heartbeat?.stop();
    this.heartbeat = null;
    if (this.socket !== null) {
      this.socket.close(1000, 'client disconnect');
      this.socket = null;
    }
    this.update({ status: 'disconnected', sessionResumed: false, connectedAt: null });
  }

  private attemptPort(port: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const url = `ws://${this.opts.host}:${port}`;
      const ws = new this.opts.WS(url);
      ws.binaryType = 'arraybuffer';

      const cleanup = (): void => {
        ws.onopen = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.onclose = null;
        clearTimeout(timer);
      };

      const fail = (msg: string): void => {
        cleanup();
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        reject(new Error(msg));
      };

      const timer = setTimeout(
        () => fail(`hello timeout on port ${port}`),
        this.opts.helloTimeoutMs,
      );

      ws.onopen = () => {
        const helloParams: HelloParams = {
          clientType: 'plugin',
          clientVersion: this.opts.clientVersion,
          protocolVersion: PROTOCOL_VERSION,
        };
        const env = createRequest({
          id: newId(),
          sessionId: this.sessionId,
          method: SystemMethod.Hello,
          params: helloParams,
        });
        ws.send(encodeEnvelope(env));
      };

      ws.onerror = () => {
        fail(`socket error on port ${port}`);
      };

      ws.onmessage = (msgEvt: MessageEvent) => {
        let envelope: Envelope;
        try {
          envelope = decodeEnvelope(msgEvt.data as ArrayBuffer);
        } catch (err) {
          fail(`decode failure: ${(err as Error).message}`);
          return;
        }

        if (envelope.kind === 'err') {
          fail(`hello rejected: ${envelope.error.message}`);
          return;
        }
        if (envelope.kind !== 'res') {
          fail(`unexpected first response kind: ${envelope.kind}`);
          return;
        }

        const result = envelope.result as HelloResult;
        cleanup();
        this.socket = ws;
        this.startHeartbeat(ws);
        this.bindLiveHandlers(ws);
        this.update({
          status: 'connected',
          port,
          sessionResumed: result.sessionResumed,
          serverVersion: result.serverVersion,
          lastError: null,
          connectedAt: Date.now(),
        });
        this.opts.log(`[relay-client] connected to :${port} (resumed=${result.sessionResumed})`);
        resolve();
      };

      ws.onclose = () => {
        fail(`socket closed before hello on port ${port}`);
      };
    });
  }

  private bindLiveHandlers(ws: WebSocket): void {
    ws.onmessage = (msgEvt: MessageEvent) => {
      let env: Envelope;
      try {
        env = decodeEnvelope(msgEvt.data as ArrayBuffer);
      } catch (err) {
        this.opts.log(`[relay-client] decode error on live socket: ${(err as Error).message}`);
        return;
      }
      this.heartbeat?.notifyReceived();
      if (env.kind === 'req' && env.method === SystemMethod.Ping) {
        ws.send(
          encodeEnvelope(
            createResponse({ id: env.id, sessionId: env.sessionId, result: { ok: true } }),
          ),
        );
        return;
      }
      if (env.kind === 'req') {
        void this.dispatchToolRequest(ws, env.id, env.sessionId, env.method, env.params);
        return;
      }
      this.opts.log(`[relay-client] <- ${env.kind} ${'method' in env ? env.method : ''}`);
    };
    ws.onclose = () => {
      this.heartbeat?.stop();
      this.heartbeat = null;
      this.socket = null;
      this.update({ status: 'disconnected', sessionResumed: false, connectedAt: null });
      if (!this.stopped) void this.runReconnectLoop();
    };
    ws.onerror = () => {
      this.update({ lastError: 'socket error' });
    };
  }

  private async dispatchToolRequest(
    ws: WebSocket,
    id: string,
    sessionId: string,
    method: string,
    params: unknown,
  ): Promise<void> {
    this.recordActivityStart(id, method, summarizePayload(params));
    const handler = this.toolHandler;
    if (handler === null) {
      const message = `no tool handler registered (method=${method})`;
      this.opts.log(`[relay-client] ${message}`);
      this.recordActivityEnd(id, 'error', message);
      ws.send(
        encodeEnvelope(createError({ id, sessionId, code: ErrorCode.MethodNotFound, message })),
      );
      return;
    }
    try {
      const result = await handler(method, params);
      this.recordActivityEnd(id, 'ok', undefined, summarizePayload(result));
      ws.send(encodeEnvelope(createResponse({ id, sessionId, result })));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.opts.log(`[relay-client] tool handler threw for ${method}: ${message}`);
      this.recordActivityEnd(id, 'error', message);
      ws.send(encodeEnvelope(createError({ id, sessionId, code: ErrorCode.Internal, message })));
    }
  }

  private recordActivityStart(id: string, method: string, request?: ActivityPayload): void {
    const entry: ActivityEntry = {
      id,
      method,
      startedAt: Date.now(),
      status: 'pending',
      ...(request === undefined ? {} : { request }),
    };
    this.update({
      totalCalls: this.state.totalCalls + 1,
      activity: [entry, ...this.state.activity].slice(0, ACTIVITY_LIMIT),
    });
  }

  private recordActivityEnd(
    id: string,
    status: ActivityStatus,
    error?: string,
    payload?: ActivityPayload,
  ): void {
    this.update({
      activity: this.state.activity.map(e =>
        e.id === id
          ? {
              ...e,
              status,
              durationMs: Date.now() - e.startedAt,
              ...(error === undefined ? {} : { error }),
              ...(payload === undefined ? {} : { payload }),
            }
          : e,
      ),
    });
  }

  private async runReconnectLoop(): Promise<void> {
    if (this.reconnecting || this.stopped) return;
    this.reconnecting = true;
    try {
      let attempt = 0;
      while (!this.stopped) {
        const delay = Math.min(
          this.opts.reconnectInitialDelayMs * 2 ** attempt,
          this.opts.reconnectMaxDelayMs,
        );
        this.update({ status: 'reconnecting' });
        // eslint-disable-next-line no-await-in-loop -- back-off pacing requires sequential awaits
        await new Promise<void>(resolve => setTimeout(resolve, delay));
        if (this.stopped) return;
        for (const port of this.opts.ports) {
          if (this.stopped) return;
          try {
            // eslint-disable-next-line no-await-in-loop -- intentional sequential port probe
            await this.attemptPort(port);
            this.update({ reconnectCount: this.state.reconnectCount + 1 });
            return;
          } catch (err) {
            this.opts.log(
              `[relay-client] reconnect port ${port} failed: ${(err as Error).message}`,
            );
          }
        }
        attempt += 1;
      }
    } finally {
      this.reconnecting = false;
    }
  }

  private startHeartbeat(ws: WebSocket): void {
    this.heartbeat?.stop();
    this.heartbeat = new HeartbeatMonitor({
      intervalMs: this.opts.heartbeatIntervalMs,
      maxMisses: this.opts.heartbeatMaxMisses,
      sendPing: () => {
        ws.send(
          encodeEnvelope(
            createRequest({
              id: newId(),
              sessionId: this.sessionId,
              method: SystemMethod.Ping,
            }),
          ),
        );
      },
      onTimeout: () => {
        this.opts.log('[relay-client] heartbeat timeout, closing socket');
        ws.close(4000, 'heartbeat timeout');
      },
    });
    this.heartbeat.start();
  }

  private update(partial: Partial<RelayClientState>): void {
    this.state = { ...this.state, ...partial };
    for (const fn of this.listeners) fn(this.state);
  }
}
