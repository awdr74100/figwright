import { describe, expect, it } from 'vitest';

import type { Follower } from '../../src/election/follower.js';
import { type Node, NodeRole } from '../../src/election/node.js';
import { handlePing, pingTool } from '../../src/tools/ping.js';
import { toToolDefinition } from '../tool-schema.js';

const pingToolDefinition = toToolDefinition(pingTool);

const makeNode = (overrides: Partial<Node> & { role?: NodeRole }): Node =>
  ({ isConflicted: () => false, port: 3055, ...overrides }) as unknown as Node;
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
          relay: { sessions: { connected: () => [] }, refusalReason: () => null },
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
    // Nothing connected and nothing refused: no reason to claim one.
    expect(result.pluginRefused).toBeUndefined();
  });

  it('reports a refused plugin rather than letting it read as "no plugin open"', async () => {
    // What an agent asked "why isn't Figma responding" has to see. Without this the empty session
    // list is indistinguishable from the plugin simply not being open, and the advice that follows
    // sends the user to check the wrong thing.
    const node = makeNode({
      role: NodeRole.Leader,
      isLeader: () => true,
      getLeader: () =>
        ({
          port: 3055,
          relay: {
            sessions: { connected: () => [] },
            refusalReason: () => 'plugin too old: this server (v0.4.0) needs … at v0.4.0 or newer',
          },
          http: undefined as never,
        }) as unknown as ReturnType<Node['getLeader']>,
    });

    const result = await handlePing({ node, follower: makeFollower({}), serverVersion: '1.0.0' });

    expect(result.pluginRefused).toMatch(/plugin too old/i);
  });

  it('surfaces a portConflict warning when the node is conflicted', async () => {
    const node = makeNode({
      role: NodeRole.Conflicted,
      isLeader: () => false,
      isConflicted: () => true,
      port: 3055,
      getLeader: () => null,
    });
    const result = await handlePing({
      node,
      follower: makeFollower({}),
      serverVersion: '1.0.0',
    });
    expect(result.hop).toBe('server-only');
    expect(result.plugin).toBeNull();
    expect(result.server.role).toBe(NodeRole.Conflicted);
    expect(result.server.portConflict).toMatch(/port 3055 is held by a non-Figwright process/);
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
            refusalReason: () => null,
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
      leaderInfo: async () => ({ serverVersion: '1.0.0', buildId: 0 }),
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
      // stale older leader still owns the plugin
      leaderInfo: async () => ({ serverVersion: '0.1.0', buildId: 100 }),
      sendRpc: async () => ({
        kind: 'ok' as const,
        requestId: 'r',
        result: { apiVersion: '1.0.0' },
      }),
    });
    const result = await handlePing({
      node,
      follower,
      serverVersion: '0.2.0',
      buildId: 200,
      log: () => {},
    });

    expect(result.server.version).toBe('0.2.0');
    expect(result.server.leaderVersion).toBe('0.1.0');
    expect(result.server.versionSkew).toMatch(/leader is v0\.1\.0.*v0\.2\.0/);
    // An older version implies an older build, so both warnings fire; buildSkew explains the
    // auto-heal (abdication) and the manual fallback.
    expect(result.server.leaderBuildId).toBe(100);
    expect(result.server.buildSkew).toMatch(/older build/);
  });

  it('flags a build skew alone when versions match but the leader build is older', async () => {
    const node = makeNode({
      role: NodeRole.Follower,
      isLeader: () => false,
      getLeader: () => null,
    });
    const follower = makeFollower({
      // Same released version, older local build — the dev-iteration zombie ping must expose.
      leaderInfo: async () => ({ serverVersion: '0.2.0', buildId: 100 }),
      sendRpc: async () => ({
        kind: 'ok' as const,
        requestId: 'r',
        result: { apiVersion: '1.0.0' },
      }),
    });
    const result = await handlePing({
      node,
      follower,
      serverVersion: '0.2.0',
      buildId: 200,
      log: () => {},
    });

    expect(result.server.versionSkew).toBeUndefined();
    expect(result.server.buildSkew).toMatch(/older build/);
    expect(result.server.buildSkew).toMatch(/lsof -iTCP:3055/);
  });

  it('reports leaderVersion with no skew warning when versions match', async () => {
    const node = makeNode({
      role: NodeRole.Follower,
      isLeader: () => false,
      getLeader: () => null,
    });
    const follower = makeFollower({
      leaderInfo: async () => ({ serverVersion: '0.2.0', buildId: 200 }),
      sendRpc: async () => ({
        kind: 'ok' as const,
        requestId: 'r',
        result: { apiVersion: '1.0.0' },
      }),
    });
    const result = await handlePing({
      node,
      follower,
      serverVersion: '0.2.0',
      buildId: 200,
      log: () => {},
    });

    expect(result.server.leaderVersion).toBe('0.2.0');
    expect(result.server.versionSkew).toBeUndefined();
    expect(result.server.buildSkew).toBeUndefined();
  });

  it('omits leaderVersion when the leader version is unreachable', async () => {
    const node = makeNode({
      role: NodeRole.Follower,
      isLeader: () => false,
      getLeader: () => null,
    });
    const follower = makeFollower({
      leaderInfo: async () => undefined,
      sendRpc: async () => ({
        kind: 'ok' as const,
        requestId: 'r',
        result: { apiVersion: '1.0.0' },
      }),
    });
    const result = await handlePing({ node, follower, serverVersion: '0.2.0', log: () => {} });

    expect(result.server.leaderVersion).toBeUndefined();
    expect(result.server.versionSkew).toBeUndefined();
    expect(result.server.buildSkew).toBeUndefined();
  });
});
