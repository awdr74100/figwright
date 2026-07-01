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

// How long a probe waits for the server's $hello reply before abandoning the socket and retrying. A
// healthy leader answers in sub-millisecond on localhost, so a probe that stays silent this long isn't
// a healthy server we're about to reach — it's a port owner mid-handoff (an old leader releasing :3055
// as a new one takes over) or a momentarily CPU-starved event loop. Waiting the old 2s each such
// attempt made a handoff feel like many seconds; 1s halves the per-retry waste while keeping a ~1000×
// margin over a healthy reply, so we never abandon a server that was actually about to answer.
const DEFAULT_HELLO_TIMEOUT_MS = 1_000;
const DEFAULT_RECONNECT_INITIAL_DELAY_MS = 250;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 5_000;
/**
 * Cold-start (never-yet-connected) polling is capped far tighter than a true reconnect: when the
 * plugin opened before the server, the user just launched their MCP client and the leader appears
 * within a second, so we want to notice almost immediately. Probing the single fixed port is a
 * sub-millisecond refused connection while nothing listens, so polling this fast is cheap. A
 * dropped live socket (hasConnected) keeps the gentler exponential ceiling instead — that's a real
 * fault, not an imminent arrival, so there's no reason to hammer it.
 */
const COLD_START_MAX_DELAY_MS = 300;

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
  /**
   * The in-flight back-off sleep's timer + its resolver, so wake()/disconnect() can cut the sleep
   * short and probe now (or exit). Both null whenever we're not mid-sleep (loop not started, or
   * already probing). settleBackoff() is the single place either one resolves.
   */
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  private settleSleep: ((woken: boolean) => void) | null = null;
  /**
   * True once we've established at least one live socket — distinguishes a cold-start retry from a
   * true reconnect.
   */
  private hasConnected = false;
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
    if (
      this.state.status === 'connecting' ||
      this.state.status === 'connected' ||
      this.state.status === 'reconnecting'
    ) {
      return;
    }
    this.stopped = false;
    this.update({ status: 'connecting', lastError: null });

    if (await this.probeAllPorts()) return;

    // No server is listening yet — most commonly the plugin was opened before the MCP server (i.e.
    // before the user's MCP client launched it). Don't treat this as terminal: keep retrying in the
    // background with the same back-off loop used after a live socket drops, so the plugin connects
    // on its own once the server appears. Failing the initial probe is not a reconnect, so the loop
    // must not bump `reconnectCount`.
    // Preserve a specific rejection reason captured during the probe (e.g. a protocol mismatch
    // recorded by attemptPort) — masking it with the generic "no server" message would be wrong when a
    // server was found but turned us away.
    this.update({
      status: 'disconnected',
      port: null,
      lastError:
        this.state.lastError ?? `no relay server found on ports [${this.opts.ports.join(', ')}]`,
    });
    if (!this.stopped) void this.runReconnectLoop();
  }

  /**
   * Probe the candidate port(s) in order; resolve true on the first successful hello, false if all
   * fail. In production `ports` is just [DEFAULT_PORT]: figwright's leader always binds that one
   * fixed port (the server never hops to a fallback), so there's no range to sweep — a miss simply
   * means the server isn't up yet and the caller retries. Probing that single port is a
   * sub-millisecond refused connection when nothing is listening, which is what lets the reconnect
   * loop poll quickly without ever stalling on an unrelated service that happens to hold a nearby
   * port.
   */
  private async probeAllPorts(): Promise<boolean> {
    for (const port of this.opts.ports) {
      if (this.stopped) return false;
      try {
        // eslint-disable-next-line no-await-in-loop -- probe candidate ports in order
        await this.attemptPort(port);
        return true;
      } catch (err) {
        this.opts.log(`[relay-client] port ${port} failed: ${(err as Error).message}`);
      }
    }
    return false;
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    // Cut short any in-flight back-off sleep so the reconnect loop sees `stopped` and exits now instead
    // of waiting out the full delay.
    this.settleBackoff(true);
    this.heartbeat?.stop();
    this.heartbeat = null;
    if (this.socket !== null) {
      this.socket.close(1000, 'client disconnect');
      this.socket = null;
    }
    this.update({ status: 'disconnected', sessionResumed: false, connectedAt: null });
  }

  /**
   * Cut the current reconnect back-off short and probe now. Browsers throttle — and after a few
   * minutes of a hidden tab, freeze — timers, so a back-off sleep that began while the user
   * switched away (e.g. to launch their MCP client) can stall long past when the server actually
   * came up. The UI calls this when the plugin tab returns to the foreground (and on any sandbox
   * context event) to collapse that dead time to ~immediate. No-op unless we're mid-reconnect: a
   * live or in-progress connection needs no nudge, and after disconnect() there's nothing to
   * resume.
   */
  wake(): void {
    if (this.stopped) return;
    if (this.state.status === 'connected' || this.state.status === 'connecting') return;
    this.settleBackoff(true);
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
          // A hello rejection (e.g. a protocol-version mismatch) is a concrete, actionable reason.
          // Record it so the UI surfaces "update your plugin" rather than the generic "no server
          // found", and so the reconnect path can preserve it (see connect()).
          this.update({ lastError: envelope.error.message });
          fail(`hello rejected: ${envelope.error.message}`);
          return;
        }
        if (envelope.kind !== 'res') {
          fail(`unexpected first response kind: ${envelope.kind}`);
          return;
        }

        const result = envelope.result as HelloResult;
        cleanup();
        this.hasConnected = true;
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
      // Sending the reply proves we're alive. Encoding a huge result blocks this single thread, so the
      // heartbeat's setInterval couldn't fire meanwhile; that coalesced tick runs right after this
      // synchronous block. Reset the clock now (before it runs) so it doesn't read the stall as death
      // and self-close the socket. Single-threaded ordering guarantees this lands first.
      this.heartbeat?.notifyReceived();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.opts.log(`[relay-client] tool handler threw for ${method}: ${message}`);
      this.recordActivityEnd(id, 'error', message);
      ws.send(encodeEnvelope(createError({ id, sessionId, code: ErrorCode.Internal, message })));
      this.heartbeat?.notifyReceived();
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
    // A live socket that dropped is a true reconnect; retrying a never-established cold-start connect
    // is not. Capture the distinction now so a successful retry only bumps `reconnectCount` in the
    // former case (keeps the diagnostic count honest), and so cold-start uses the tighter ceiling —
    // the server is imminent, so we probe more eagerly. (hasConnected only flips false→true, and a
    // successful probe returns, so it's stable for this loop's lifetime.)
    const countSuccessAsReconnect = this.hasConnected;
    const maxDelay = this.hasConnected ? this.opts.reconnectMaxDelayMs : COLD_START_MAX_DELAY_MS;
    try {
      let attempt = 0;
      while (!this.stopped) {
        const delay = Math.min(this.opts.reconnectInitialDelayMs * 2 ** attempt, maxDelay);
        this.update({ status: 'reconnecting' });
        // eslint-disable-next-line no-await-in-loop -- back-off pacing requires sequential awaits
        const woken = await this.backoffSleep(delay);
        if (this.stopped) return;
        // eslint-disable-next-line no-await-in-loop -- back-off pacing requires sequential awaits
        if (await this.probeAllPorts()) {
          if (countSuccessAsReconnect) {
            this.update({ reconnectCount: this.state.reconnectCount + 1 });
          }
          return;
        }
        // A wake (tab refocus) means the user is back and expecting a live connection — restart the
        // back-off from the floor so we keep probing quickly rather than easing back to the ceiling.
        attempt = woken ? 0 : attempt + 1;
      }
    } finally {
      this.reconnecting = false;
    }
  }

  /**
   * Sleep `ms`, or resolve early if wake()/disconnect() fires. Resolves true when cut short, false
   * on a natural timeout — the loop resets its back-off on a wake so a post-foreground probe starts
   * fast.
   */
  private backoffSleep(ms: number): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      this.settleSleep = resolve;
      this.wakeTimer = setTimeout(() => this.settleBackoff(false), ms);
    });
  }

  /**
   * Resolve the in-flight back-off sleep exactly once, from whichever source fires first — the
   * timer (woken=false) or wake()/disconnect() (woken=true). Nulling `settleSleep` first makes it
   * idempotent, so the losing source is a no-op. Also the single place the pending timer is
   * cleared.
   */
  private settleBackoff(woken: boolean): void {
    const resolve = this.settleSleep;
    if (resolve === null) return;
    this.settleSleep = null;
    if (this.wakeTimer !== null) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
    }
    resolve(woken);
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
