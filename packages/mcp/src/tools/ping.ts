import { dispatchTool } from '../dispatch.js';
import type { Follower } from '../election/follower.js';
import { type Node, NodeRole } from '../election/node.js';
import type { ToolSpec } from './spec.js';

export const PING_TOOL_NAME = 'ping';

export const pingTool: ToolSpec = {
  name: PING_TOOL_NAME,
  description:
    'Health check. Returns server info plus, when a plugin is connected, end-to-end info from the Figma sandbox.',
  inputShape: {},
  kind: 'read',
};
export type PingHop = 'server-only' | 'e2e';

export interface PingServerInfo {
  version: string;
  role: NodeRole;
  port: number | null;
  ts: number;
}

/**
 * Multi-plugin observability. `connectedCount` lets a user see when more than one Figma file has
 * the plugin open; `routedSessionId` names the session that handled this call (most-recently-active
 * wins). `routedFileName` / `routedPageName` come from the routed session's last `$activity` event
 * — null until that session has pushed at least one context update.
 */
export interface PingSessionInfo {
  id: string;
  fileName: string | null;
  pageName: string | null;
  lastActivityAt: number;
}

export interface PingSessionsInfo {
  connectedCount: number;
  routedSessionId: string | null;
  routedFileName: string | null;
  routedPageName: string | null;
  /** All connected sessions, newest activity first — quick `who's connected and where` table. */
  all: readonly PingSessionInfo[];
}

export interface PingResult {
  ok: true;
  hop: PingHop;
  server: PingServerInfo;
  sessions?: PingSessionsInfo;
  plugin: unknown | null;
  dispatchError?: string;
}

export interface PingContext {
  node: Node;
  follower: Follower;
  serverVersion: string;
  log?: (msg: string) => void;
}

const serverInfo = (ctx: PingContext): PingServerInfo => ({
  version: ctx.serverVersion,
  role: ctx.node.role,
  port: ctx.node.isLeader() ? (ctx.node.getLeader()?.port ?? null) : null,
  ts: Date.now(),
});

export const handlePing = async (ctx: PingContext): Promise<PingResult> => {
  const server = serverInfo(ctx);
  const relay = ctx.node.isLeader() ? ctx.node.getLeader()?.relay : undefined;

  if (relay !== undefined) {
    const connected = relay.sessions.connected();
    if (connected.length === 0) {
      return {
        ok: true,
        hop: 'server-only',
        server,
        sessions: {
          connectedCount: 0,
          routedSessionId: null,
          routedFileName: null,
          routedPageName: null,
          all: [],
        },
        plugin: null,
      };
    }
    const routed = relay.pickActiveSession();
    const all: PingSessionInfo[] = [...connected]
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      .map(s => ({
        id: s.id,
        fileName: s.fileName,
        pageName: s.pageName,
        lastActivityAt: s.lastActivityAt,
      }));
    const sessions: PingSessionsInfo = {
      connectedCount: connected.length,
      routedSessionId: routed?.id ?? null,
      routedFileName: routed?.fileName ?? null,
      routedPageName: routed?.pageName ?? null,
      all,
    };

    try {
      const plugin = await dispatchTool(
        {
          node: ctx.node,
          follower: ctx.follower,
          ...(ctx.log === undefined ? {} : { log: ctx.log }),
        },
        'ping',
        {},
      );
      return { ok: true, hop: 'e2e', server, sessions, plugin };
    } catch (err) {
      const dispatchError = err instanceof Error ? err.message : String(err);
      ctx.log?.(`[ping] dispatch failed, falling back to server-only: ${dispatchError}`);
      return { ok: true, hop: 'server-only', server, sessions, plugin: null, dispatchError };
    }
  }

  // Follower path — no direct relay visibility, so no sessions info.
  try {
    const plugin = await dispatchTool(
      {
        node: ctx.node,
        follower: ctx.follower,
        ...(ctx.log === undefined ? {} : { log: ctx.log }),
      },
      'ping',
      {},
    );
    return { ok: true, hop: 'e2e', server, plugin };
  } catch (err) {
    const dispatchError = err instanceof Error ? err.message : String(err);
    ctx.log?.(`[ping] dispatch failed, falling back to server-only: ${dispatchError}`);
    return { ok: true, hop: 'server-only', server, plugin: null, dispatchError };
  }
};

export const formatPingResult = (result: PingResult): string => JSON.stringify(result, null, 2);

// re-export to keep call-sites stable; NodeRole is the canonical role enum from election/node
export { NodeRole };
