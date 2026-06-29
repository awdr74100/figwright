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

  it('returns e2e hop with plugin info + sessions when dispatch succeeds (leader path)', async () => {
    const pluginInfo = { apiVersion: '1.0.0', currentPageId: 'p1' };
    const sessA = {
      id: 'sess-a',
      fileName: 'Design A',
      pageName: 'Mockup',
      lastActivityAt: 1000,
    };
    const sessB = {
      id: 'sess-b',
      fileName: 'Design B',
      pageName: 'Cover',
      lastActivityAt: 2000,
    };
    const node = makeNode({
      role: NodeRole.Leader,
      isLeader: () => true,
      getLeader: () =>
        ({
          port: 3055,
          relay: {
            sessions: { connected: () => [sessA, sessB] },
            pickActiveSession: () => sessB,
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
    expect(result.sessions?.connectedCount).toBe(2);
    expect(result.sessions?.routedSessionId).toBe('sess-b');
    expect(result.sessions?.routedFileName).toBe('Design B');
    expect(result.sessions?.routedPageName).toBe('Cover');
    // All sessions sorted newest-active first.
    expect(result.sessions?.all.map(s => s.id)).toEqual(['sess-b', 'sess-a']);
  });

  it('falls back to server-only when dispatch throws (follower path)', async () => {
    const node = makeNode({
      role: NodeRole.Follower,
      isLeader: () => false,
      getLeader: () => null,
    });
    const follower = makeFollower({
      resolveLeaderVersion: async () => '1.0.0',
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

  it('flags a leader/follower version skew (zombie-leader trap)', async () => {
    const node = makeNode({
      role: NodeRole.Follower,
      isLeader: () => false,
      getLeader: () => null,
    });
    const follower = makeFollower({
      resolveLeaderVersion: async () => '0.1.0', // stale older leader still owns the plugin
      sendRpc: async () => ({
        kind: 'ok' as const,
        requestId: 'r',
        result: { apiVersion: '1.0.0' },
      }),
    });
    const result = await handlePing({ node, follower, serverVersion: '0.2.0', log: () => {} });

    expect(result.server.version).toBe('0.2.0');
    expect(result.server.leaderVersion).toBe('0.1.0');
    expect(result.server.versionSkew).toMatch(/leader is v0\.1\.0.*v0\.2\.0/);
  });

  it('reports leaderVersion with no skew warning when versions match', async () => {
    const node = makeNode({
      role: NodeRole.Follower,
      isLeader: () => false,
      getLeader: () => null,
    });
    const follower = makeFollower({
      resolveLeaderVersion: async () => '0.2.0',
      sendRpc: async () => ({
        kind: 'ok' as const,
        requestId: 'r',
        result: { apiVersion: '1.0.0' },
      }),
    });
    const result = await handlePing({ node, follower, serverVersion: '0.2.0', log: () => {} });

    expect(result.server.leaderVersion).toBe('0.2.0');
    expect(result.server.versionSkew).toBeUndefined();
  });

  it('omits leaderVersion when the leader version is unreachable', async () => {
    const node = makeNode({
      role: NodeRole.Follower,
      isLeader: () => false,
      getLeader: () => null,
    });
    const follower = makeFollower({
      resolveLeaderVersion: async () => undefined,
      sendRpc: async () => ({
        kind: 'ok' as const,
        requestId: 'r',
        result: { apiVersion: '1.0.0' },
      }),
    });
    const result = await handlePing({ node, follower, serverVersion: '0.2.0', log: () => {} });

    expect(result.server.leaderVersion).toBeUndefined();
    expect(result.server.versionSkew).toBeUndefined();
  });
});
