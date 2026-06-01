import type { Server as HttpServer } from 'node:http';

import {
  ActivityParamsSchema,
  createError,
  createRequest,
  createResponse,
  decodeEnvelope,
  encodeEnvelope,
  type Envelope,
  ErrorCode,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_MAX_MISSES,
  HeartbeatMonitor,
  HelloParamsSchema,
  type HelloResult,
  newId,
  PROTOCOL_VERSION,
  SystemMethod,
} from '@figma-mcp-relay/shared';
import { WebSocketServer, type WebSocket } from 'ws';

import { DEFAULT_DISCONNECT_GRACE_MS, type Session, SessionManager } from './session.js';

export interface RelayOptions {
  serverVersion: string;
  server: HttpServer;
  log?: (msg: string) => void;
  heartbeatIntervalMs?: number;
  heartbeatMaxMisses?: number;
  disconnectGraceMs?: number;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
  params: unknown;
  dispatched: boolean;
  // When set, this request is pinned to one session: it only dispatches/flushes to that session,
  // never to whoever happens to be most-active. Used to keep a multi-call tool's sub-calls together.
  pinnedSessionId: string | undefined;
  // Epoch ms the request entered the relay — used to log server-observed round-trip time, so a slow
  // tool's real cost can be told apart from a client-side give-up (see routing/timeout stability work).
  startedAt: number;
}

export const DEFAULT_PLUGIN_REQUEST_TIMEOUT_MS = 30_000;

export class Relay {
  readonly sessions = new SessionManager();
  private readonly wss: WebSocketServer;
  private readonly opts: Required<Omit<RelayOptions, 'server'>>;
  private readonly pending = new Map<string, Pending>();

  constructor(opts: RelayOptions) {
    this.opts = {
      serverVersion: opts.serverVersion,
      log: opts.log ?? (() => {}),
      heartbeatIntervalMs: opts.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS,
      heartbeatMaxMisses: opts.heartbeatMaxMisses ?? HEARTBEAT_MAX_MISSES,
      disconnectGraceMs: opts.disconnectGraceMs ?? DEFAULT_DISCONNECT_GRACE_MS,
    };
    this.wss = new WebSocketServer({ server: opts.server });
    this.wss.on('connection', socket => this.handleConnection(socket));
  }

  async stop(): Promise<void> {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(`relay stopping (pending ${p.method})`));
    }
    this.pending.clear();
    this.sessions.clear();
    for (const client of this.wss.clients) {
      client.terminate();
    }
    await new Promise<void>(resolve => this.wss.close(() => resolve()));
  }

  sendRequest(
    method: string,
    params?: unknown,
    timeoutMs: number = DEFAULT_PLUGIN_REQUEST_TIMEOUT_MS,
    sessionId?: string,
  ): Promise<unknown> {
    const id = newId();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`plugin request timeout (method=${method})`));
      }, timeoutMs);
      const entry: Pending = {
        resolve,
        reject,
        timer,
        method,
        params,
        dispatched: false,
        pinnedSessionId: sessionId,
        startedAt: Date.now(),
      };
      this.pending.set(id, entry);

      if (sessionId !== undefined) {
        // Pinned: route only to this session. If it's fully gone (not even within the disconnect
        // grace window) fail fast — silently re-routing to another plugin is the drift bug we're
        // fixing. If it exists but is momentarily socket-less, queue and flushQueue will deliver it
        // when that same session reconnects (session ids survive resume).
        const target = this.sessions.get(sessionId);
        if (target === undefined) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(
            new Error(`pinned session not connected (sessionId=${sessionId}, method=${method})`),
          );
          return;
        }
        if (target.socket !== null && target.state === 'connected') {
          this.dispatchPending(id, entry, target);
        } else {
          this.opts.log(`[relay] queued ${method} (pinned session ${sessionId} reconnecting)`);
        }
        return;
      }

      const session = this.pickActiveSession();
      if (session !== undefined && session.socket !== null) {
        this.dispatchPending(id, entry, session);
      } else {
        this.opts.log(`[relay] queued ${method} (no plugin connected)`);
      }
    });
  }

  pendingCount(): number {
    return this.pending.size;
  }

  queuedCount(): number {
    let n = 0;
    for (const [, p] of this.pending) if (!p.dispatched) n += 1;
    return n;
  }

  /**
   * Pick the connected session with the highest `lastActivityAt`. When the user opens the plugin in
   * a newly-focused Figma file, that fresh session wins routing over an older idle one — the effect
   * a user expects when they "switch which file Claude is looking at". With one plugin it's just
   * that plugin; with N it's the most-recently-active.
   */
  pickActiveSession(): Session | undefined {
    let best: Session | undefined;
    for (const s of this.sessions.connected()) {
      if (best === undefined || s.lastActivityAt > best.lastActivityAt) best = s;
    }
    return best;
  }

  /**
   * The id of the session routing would currently pick. A multi-call tool resolves this once up
   * front and then pins every sub-call to it, so the group can't drift across plugins if activity
   * flips mid-flight. Returns undefined when no plugin is connected (caller falls back to unpinned
   * live routing, which is the right cold-start behavior).
   */
  pickActiveSessionId(): string | undefined {
    return this.pickActiveSession()?.id;
  }

  private dispatchPending(id: string, entry: Pending, session: Session): void {
    if (session.socket === null) return;
    entry.dispatched = true;
    session.socket.send(
      encodeEnvelope(
        createRequest({ id, sessionId: session.id, method: entry.method, params: entry.params }),
      ),
    );
  }

  private flushQueue(session: Session): void {
    if (session.socket === null) return;
    let flushed = 0;
    for (const [id, entry] of this.pending) {
      if (entry.dispatched) continue;
      // A pinned request only flushes to its own session — never to whichever plugin reconnects
      // first. An unpinned queued request flushes to whoever shows up.
      if (entry.pinnedSessionId !== undefined && entry.pinnedSessionId !== session.id) continue;
      this.dispatchPending(id, entry, session);
      flushed += 1;
    }
    if (flushed > 0)
      this.opts.log(`[relay] flushed ${flushed} queued request(s) to session ${session.id}`);
  }

  private handleConnection(socket: WebSocket): void {
    socket.binaryType = 'nodebuffer';

    let session: Session | undefined;

    const helloTimeout = setTimeout(() => {
      if (session === undefined) {
        this.opts.log('[relay] hello timeout, closing socket');
        socket.close(1008, 'hello timeout');
      }
    }, 5_000);

    socket.on('message', raw => {
      let envelope: Envelope;
      try {
        envelope = decodeEnvelope(raw as Uint8Array);
      } catch (err) {
        this.opts.log(`[relay] decode error: ${(err as Error).message}`);
        socket.close(1003, 'invalid envelope');
        return;
      }

      if (session === undefined) {
        clearTimeout(helloTimeout);
        session = this.handleHello(socket, envelope) ?? undefined;
        if (session === undefined) socket.close(1008, 'hello failed');
        return;
      }

      this.handleEnvelope(session, envelope);
    });

    socket.on('close', () => {
      clearTimeout(helloTimeout);
      if (session !== undefined) {
        this.opts.log(
          `[relay] session ${session.id} disconnected (grace ${this.opts.disconnectGraceMs}ms)`,
        );
        this.sessions.markDisconnected(session, this.opts.disconnectGraceMs);
      }
    });

    socket.on('error', err => {
      this.opts.log(`[relay] socket error: ${err.message}`);
    });
  }

  private handleHello(socket: WebSocket, env: Envelope): Session | null {
    if (env.kind !== 'req' || env.method !== SystemMethod.Hello) {
      this.sendError(socket, env, ErrorCode.InvalidRequest, 'first message must be $hello');
      return null;
    }

    const parsed = HelloParamsSchema.safeParse(env.params);
    if (!parsed.success) {
      this.sendError(socket, env, ErrorCode.InvalidParams, 'invalid $hello params');
      return null;
    }

    const { session, resumed } = this.sessions.register({
      id: env.sessionId,
      socket,
      clientVersion: parsed.data.clientVersion,
    });

    session.heartbeat = new HeartbeatMonitor({
      intervalMs: this.opts.heartbeatIntervalMs,
      maxMisses: this.opts.heartbeatMaxMisses,
      sendPing: () => this.sendPing(session),
      onTimeout: () => {
        this.opts.log(`[relay] session ${session.id} heartbeat timeout`);
        socket.close(1001, 'heartbeat timeout');
      },
    });
    session.heartbeat.start();

    const result: HelloResult = {
      serverVersion: this.opts.serverVersion,
      protocolVersion: PROTOCOL_VERSION,
      sessionResumed: resumed,
    };
    this.sendResponse(socket, env, result);
    this.opts.log(`[relay] session ${session.id} hello (resumed=${resumed})`);
    this.flushQueue(session);
    return session;
  }

  private handleEnvelope(session: Session, env: Envelope): void {
    session.heartbeat?.notifyReceived();
    // Routing priority: only an explicit $activity event counts as user interaction. Heartbeat
    // replies and tool responses must NOT bump lastActivityAt — both fire on a timer / on
    // server-initiated calls and would race the two sessions to a coin flip every 15s.
    if (env.kind === 'evt' && env.method === SystemMethod.Activity) {
      session.lastActivityAt = Date.now();
      const parsed = ActivityParamsSchema.safeParse(env.params);
      if (parsed.success) {
        // Params carry the current file/page so `ping` can advertise it; routing decision and
        // user-facing label come off the same event.
        session.fileName = parsed.data.fileName;
        session.pageId = parsed.data.pageId;
        session.pageName = parsed.data.pageName;
      }
      return;
    }
    if (env.kind === 'req' && env.method === SystemMethod.Ping) {
      if (session.socket !== null) this.sendResponse(session.socket, env, { ok: true });
      return;
    }
    if (env.kind === 'res') {
      const p = this.pending.get(env.id);
      if (p !== undefined) {
        clearTimeout(p.timer);
        this.pending.delete(env.id);
        this.logRoundTrip(p, 'ok');
        p.resolve(env.result);
      }
      return;
    }
    if (env.kind === 'err') {
      const p = this.pending.get(env.id);
      if (p !== undefined) {
        clearTimeout(p.timer);
        this.pending.delete(env.id);
        this.logRoundTrip(p, 'err');
        p.reject(new Error(`${env.error.code}: ${env.error.message}`));
      }
      return;
    }
    this.opts.log(
      `[relay] session ${session.id} <- ${env.kind} ${'method' in env ? env.method : ''}`,
    );
  }

  // Server-observed round-trip time for a completed plugin request. Lets a slow tool's real cost be
  // separated from a client-side give-up (e.g. an MCP wrapper that abandons a call at 10s while the
  // plugin is still working). Only logs the slow ones so it isn't noise on the hot path.
  private logRoundTrip(p: Pending, outcome: 'ok' | 'err'): void {
    const elapsed = Date.now() - p.startedAt;
    if (elapsed >= 2_000) {
      this.opts.log(`[relay] ${p.method} ${outcome} in ${elapsed}ms (server-observed round-trip)`);
    }
  }

  private sendPing(session: Session): void {
    if (session.socket === null) return;
    session.socket.send(
      encodeEnvelope(
        createRequest({
          id: newId(),
          sessionId: session.id,
          method: SystemMethod.Ping,
        }),
      ),
    );
  }

  private sendResponse(socket: WebSocket, req: Envelope, result: unknown): void {
    socket.send(encodeEnvelope(createResponse({ id: req.id, sessionId: req.sessionId, result })));
  }

  private sendError(socket: WebSocket, req: Envelope, code: string, message: string): void {
    socket.send(
      encodeEnvelope(
        createError({
          id: req.id || newId(),
          sessionId: req.sessionId || newId(),
          code,
          message,
        }),
      ),
    );
  }
}
