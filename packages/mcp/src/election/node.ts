import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { DEFAULT_PORT } from '@figwright/shared';

import { Relay } from '../relay/relay.js';

export const NodeRole = {
  Unknown: 'unknown',
  Leader: 'leader',
  Follower: 'follower',
  // The port is held by a process that isn't a Figwright leader (it didn't answer a Figwright /ping),
  // so this node can neither lead nor safely follow it. It keeps contending for the port instead of
  // attaching as a follower of a foreign process. See Election.determineRole / tick.
  Conflicted: 'conflicted',
} as const;
export type NodeRole = (typeof NodeRole)[keyof typeof NodeRole];

export interface NodeOptions {
  serverVersion: string;
  port?: number;
  host?: string;
  log?: (msg: string) => void;
}

export interface LeaderResources {
  http: HttpServer;
  relay: Relay;
  port: number;
}

export const isAddressInUse = (err: unknown): boolean =>
  err !== null &&
  typeof err === 'object' &&
  'code' in err &&
  (err as { code?: string }).code === 'EADDRINUSE';

export class Node {
  private currentRole: NodeRole = NodeRole.Unknown;
  private leader: LeaderResources | null = null;
  private readonly opts: Required<NodeOptions>;
  private readonly listeners = new Set<(role: NodeRole) => void>();

  constructor(opts: NodeOptions) {
    this.opts = {
      serverVersion: opts.serverVersion,
      port: opts.port ?? DEFAULT_PORT,
      host: opts.host ?? '127.0.0.1',
      log: opts.log ?? (() => {}),
    };
  }

  get role(): NodeRole {
    return this.currentRole;
  }

  isLeader(): boolean {
    return this.currentRole === NodeRole.Leader;
  }

  isFollower(): boolean {
    return this.currentRole === NodeRole.Follower;
  }

  isConflicted(): boolean {
    return this.currentRole === NodeRole.Conflicted;
  }

  get port(): number {
    return this.opts.port;
  }

  get leaderUrl(): string {
    return `http://${this.opts.host}:${this.opts.port}`;
  }

  async becomeLeader(): Promise<LeaderResources> {
    if (this.currentRole === NodeRole.Leader && this.leader !== null) return this.leader;

    const http = createServer();
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: NodeJS.ErrnoException): void => {
          http.removeListener('listening', onListening);
          reject(err);
        };
        const onListening = (): void => {
          http.removeListener('error', onError);
          resolve();
        };
        http.once('error', onError);
        http.once('listening', onListening);
        http.listen(this.opts.port, this.opts.host);
      });
    } catch (err) {
      http.close();
      throw err;
    }

    const relay = new Relay({
      serverVersion: this.opts.serverVersion,
      server: http,
      log: this.opts.log,
    });
    const port = (http.address() as AddressInfo).port;
    this.leader = { http, relay, port };
    this.setRole(NodeRole.Leader);
    this.opts.log(`[node] became LEADER on :${port}`);
    return this.leader;
  }

  becomeFollower(): void {
    if (this.currentRole === NodeRole.Follower) return;
    if (this.leader !== null) {
      const { http, relay } = this.leader;
      this.leader = null;
      void relay.stop().catch(() => {
        /* ignore */
      });
      http.close();
    }
    this.setRole(NodeRole.Follower);
    this.opts.log(`[node] became FOLLOWER (leader @ ${this.leaderUrl})`);
  }

  /**
   * Enter the port-conflict state: :port is held by a process that isn't a Figwright leader. Unlike
   * becomeFollower this never points RPC at the squatter — dispatch fails fast with a clear message
   * while the election keeps contending for the port (see Election.tick), so the moment the
   * squatter releases :port we take over. Idempotent.
   */
  becomeConflicted(): void {
    if (this.currentRole === NodeRole.Conflicted) return;
    if (this.leader !== null) {
      const { http, relay } = this.leader;
      this.leader = null;
      void relay.stop().catch(() => {
        /* ignore */
      });
      http.close();
    }
    this.setRole(NodeRole.Conflicted);
    this.opts.log(`[node] PORT CONFLICT — :${this.opts.port} is held by a non-Figwright process`);
  }

  getLeader(): LeaderResources | null {
    return this.leader;
  }

  onRoleChange(listener: (role: NodeRole) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async stop(): Promise<void> {
    if (this.leader !== null) {
      const { http, relay } = this.leader;
      this.leader = null;
      await relay.stop();
      await new Promise<void>(resolve => http.close(() => resolve()));
    }
    this.currentRole = NodeRole.Unknown;
    this.listeners.clear();
  }

  private setRole(role: NodeRole): void {
    if (this.currentRole === role) return;
    this.currentRole = role;
    for (const l of this.listeners) l(role);
  }
}
