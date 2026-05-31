import type { HeartbeatMonitor } from '@figma-mcp-relay/shared';
import type { WebSocket } from 'ws';

export type SessionState = 'connected' | 'disconnected';

export interface Session {
  id: string;
  socket: WebSocket | null;
  state: SessionState;
  clientVersion: string;
  connectedAt: number;
  reconnectedAt: number | null;
  /** Updated on every `$activity` event from this session; multi-plugin routing picks the max. */
  lastActivityAt: number;
  /** Latest file + page reported by this session's `$activity` events — for ping observability. */
  fileName: string | null;
  pageId: string | null;
  pageName: string | null;
  heartbeat: HeartbeatMonitor | null;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
}

export const DEFAULT_DISCONNECT_GRACE_MS = 30_000;

export class SessionManager {
  private readonly sessions = new Map<string, Session>();

  register(input: { id: string; socket: WebSocket; clientVersion: string }): {
    session: Session;
    resumed: boolean;
  } {
    const existing = this.sessions.get(input.id);
    let resumed = false;

    if (existing !== undefined) {
      if (existing.disconnectTimer !== null) {
        clearTimeout(existing.disconnectTimer);
        existing.disconnectTimer = null;
      }
      existing.heartbeat?.stop();
      if (existing.state === 'connected' && existing.socket !== null) {
        existing.socket.close(1001, 'session replaced');
      }
      resumed = true;
    }

    const now = Date.now();
    const session: Session = {
      id: input.id,
      socket: input.socket,
      state: 'connected',
      clientVersion: input.clientVersion,
      connectedAt: existing?.connectedAt ?? now,
      reconnectedAt: existing !== undefined ? now : null,
      // A fresh connection counts as the most recent activity — when a user opens the plugin in
      // a newly-focused file it should immediately win routing against an idle older session.
      lastActivityAt: now,
      // Filled in by the first `$activity` event; null until then (a plugin that hasn't sent any
      // context push yet — e.g. mid-handshake — is still routable but won't have a display label).
      fileName: existing?.fileName ?? null,
      pageId: existing?.pageId ?? null,
      pageName: existing?.pageName ?? null,
      heartbeat: null,
      disconnectTimer: null,
    };

    this.sessions.set(input.id, session);
    return { session, resumed };
  }

  markDisconnected(session: Session, graceMs: number): void {
    const current = this.sessions.get(session.id);
    if (current !== session) return;
    if (session.disconnectTimer !== null) clearTimeout(session.disconnectTimer);
    session.state = 'disconnected';
    session.socket = null;
    session.heartbeat?.stop();
    session.heartbeat = null;
    session.disconnectTimer = setTimeout(() => {
      if (this.sessions.get(session.id) === session) {
        this.sessions.delete(session.id);
      }
    }, graceMs);
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  remove(id: string): void {
    const s = this.sessions.get(id);
    if (s !== undefined && s.disconnectTimer !== null) {
      clearTimeout(s.disconnectTimer);
    }
    this.sessions.delete(id);
  }

  list(): readonly Session[] {
    return [...this.sessions.values()];
  }

  connected(): readonly Session[] {
    return this.list().filter(s => s.state === 'connected' && s.socket !== null);
  }

  clear(): void {
    for (const s of this.sessions.values()) {
      if (s.disconnectTimer !== null) clearTimeout(s.disconnectTimer);
    }
    this.sessions.clear();
  }
}
