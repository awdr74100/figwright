import { describe, expect, it } from 'vitest';

import type { Follower } from '../../src/election/follower.js';
import { type Node, NodeRole } from '../../src/election/node.js';
import { handlePing, pingTool } from '../../src/tools/ping.js';
import { toToolDefinition } from '../tool-schema.js';

const pingToolDefinition = toToolDefinition(pingTool);

const makeNode = (overrides: Partial<Node> & { role?: NodeRole }): Node =>
  overrides as unknown as Node;
const makeFollower = (overrides: Partial<Follower>): Follower => overrides as unknown as Follower;

describe('ping tool', () => {
  it('exposes a valid MCP tool definition', () => {
    expect(pingToolDefinition.name).toBe('ping');
    expect(pingToolDefinition.inputSchema.type).toBe('object');
  });

  it('returns server-only hop when leader has no plugin connected', async () => {
    const node = makeNode({
      role: NodeRole.Leader,
      isLeader: () => true,
      getLeader: () =>
        ({
          port: 3055,
          relay: { sessions: { connected: () => [] } },
          http: undefined as never,
        }) as unknown as ReturnType<Node['getLeader']>,
    });
    const result = await handlePing({
      node,
      follower: makeFollower({}),
      serverVersion: '1.0.0',
    });
    expect(result.ok).toBe(true);
    expect(result.hop).toBe('server-only');
    expect(result.plugin).toBeNull();
    expect(result.server.version).toBe('1.0.0');
    expect(result.server.role).toBe(NodeRole.Leader);
    expect(result.server.port).toBe(3055);
  });

  it('returns e2e hop with plugin info when dispatch succeeds (leader path)', async () => {
    const pluginInfo = { apiVersion: '1.0.0', currentPageId: 'p1' };
    const node = makeNode({
      role: NodeRole.Leader,
      isLeader: () => true,
      getLeader: () =>
        ({
          port: 3055,
          relay: {
            sessions: { connected: () => [{}] },
            sendRequest: async () => pluginInfo,
          },
          http: undefined as never,
        }) as unknown as ReturnType<Node['getLeader']>,
    });
    const result = await handlePing({
      node,
      follower: makeFollower({}),
      serverVersion: '1.0.0',
    });
    expect(result.hop).toBe('e2e');
    expect(result.plugin).toEqual(pluginInfo);
  });

  it('falls back to server-only when dispatch throws (follower path)', async () => {
    const node = makeNode({
      role: NodeRole.Follower,
      isLeader: () => false,
      getLeader: () => null,
    });
    const follower = makeFollower({
      sendRpc: async () => ({
        kind: 'err' as const,
        requestId: 'r',
        code: 'PLUGIN_DISCONNECTED',
        message: 'no plugin connected',
      }),
    });
    const result = await handlePing({
      node,
      follower,
      serverVersion: '1.0.0',
      log: () => {},
    });
    expect(result.hop).toBe('server-only');
    expect(result.plugin).toBeNull();
    expect(result.dispatchError).toContain('no plugin connected');
    expect(result.server.role).toBe(NodeRole.Follower);
    expect(result.server.port).toBeNull();
  });
});
