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
  heartbeat: HeartbeatMonitor | null;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
}

export const DEFAULT_DISCONNECT_GRACE_MS = 30_000;

export class SessionManager {
  private readonly sessions = new Map<string, Session>();

  register(input: {
    id: string;
    socket: WebSocket;
    clientVersion: string;
  }): { session: Session; resumed: boolean } {
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

    const session: Session = {
      id: input.id,
      socket: input.socket,
      state: 'connected',
      clientVersion: input.clientVersion,
      connectedAt: existing?.connectedAt ?? Date.now(),
      reconnectedAt: existing !== undefined ? Date.now() : null,
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
