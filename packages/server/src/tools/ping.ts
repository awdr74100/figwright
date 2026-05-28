import { dispatchTool } from '../dispatch.js';
import type { Follower } from '../election/follower.js';
import { type Node, NodeRole } from '../election/node.js';
import { specToToolDefinition, type ToolSpec } from './spec.js';

export const PING_TOOL_NAME = 'ping';

export const pingTool: ToolSpec = {
  name: PING_TOOL_NAME,
  description:
    'Health check. Returns server info plus, when a plugin is connected, end-to-end info from the Figma sandbox.',
  inputShape: {},
  kind: 'read',
};

export const pingToolDefinition = specToToolDefinition(pingTool);

export type PingHop = 'server-only' | 'e2e';

export interface PingServerInfo {
  version: string;
  role: NodeRole;
  port: number | null;
  ts: number;
}

export interface PingResult {
  ok: true;
  hop: PingHop;
  server: PingServerInfo;
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

  if (ctx.node.isLeader()) {
    const connected = ctx.node.getLeader()?.relay.sessions.connected().length ?? 0;
    if (connected === 0) {
      return { ok: true, hop: 'server-only', server, plugin: null };
    }
  }

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
