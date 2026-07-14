import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { Election } from '../../src/election/election.js';
import { Follower } from '../../src/election/follower.js';
import { attachLeaderEndpoints } from '../../src/election/leader-endpoints.js';
import { Node, NodeRole } from '../../src/election/node.js';
import { Relay } from '../../src/relay/relay.js';

interface LeaderHarness {
  node: Node;
  http: HttpServer;
  relay: Relay;
  port: number;
  detach: () => void;
}

const harnesses: LeaderHarness[] = [];
const extraNodes: Node[] = [];
const extraElections: Election[] = [];
const blockers: HttpServer[] = [];

afterEach(async () => {
  for (const e of extraElections) e.stop();
  extraElections.length = 0;
  await Promise.all(extraNodes.map(n => n.stop()));
  extraNodes.length = 0;
  await Promise.all(
    harnesses.map(async h => {
      h.detach();
      await h.relay.stop();
      h.http.closeAllConnections();
      await new Promise<void>(resolve => h.http.close(() => resolve()));
    }),
  );
  harnesses.length = 0;
  await Promise.all(blockers.map(s => new Promise<void>(r => s.close(() => r()))));
  blockers.length = 0;
});

const freePort = async (): Promise<number> => {
  const s = createServer();
  await new Promise<void>(resolve => s.listen(0, '127.0.0.1', () => resolve()));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>(resolve => s.close(() => resolve()));
  return port;
};

const startLeaderHarness = async (port: number): Promise<LeaderHarness> => {
  const node = new Node({ serverVersion: 'leader-1.0.0', port });
  const res = await node.becomeLeader();
  const detach = attachLeaderEndpoints(res.http, {
    relay: res.relay,
    serverVersion: 'leader-1.0.0',
  });
  const h: LeaderHarness = {
    node,
    http: res.http,
    relay: res.relay,
    port: res.port,
    detach,
  };
  harnesses.push(h);
  return h;
};

const buildElection = (
  port: number,
  pingTimeoutMs = 200,
  buildId = 0,
  log?: (msg: string) => void,
): { node: Node; election: Election; follower: Follower } => {
  const node = new Node({ serverVersion: 'challenger-1.0.0', port });
  extraNodes.push(node);
  const follower = new Follower({
    leaderUrl: `http://127.0.0.1:${port}`,
    pingTimeoutMs,
  });
  const election = new Election({
    node,
    follower,
    buildId,
    tickIntervalMs: 1_000_000,
    ...(log === undefined ? {} : { log }),
  });
  extraElections.push(election);
  return { node, election, follower };
};

/**
 * A leader wired the way index.ts wires production: its own Election owns the node, and the
 * /abdicate endpoint releases leadership via election.yieldLeadership. quiet window 0 so tests
 * don't wait out ABDICATE_QUIET_WINDOW_MS.
 */
const startLeaderWithElection = async (
  port: number,
  buildId: number,
): Promise<{ node: Node; election: Election }> => {
  const node = new Node({ serverVersion: 'leader-1.0.0', port });
  extraNodes.push(node);
  const follower = new Follower({ leaderUrl: `http://127.0.0.1:${port}`, pingTimeoutMs: 200 });
  const election = new Election({ node, follower, buildId, tickIntervalMs: 1_000_000 });
  extraElections.push(election);
  await election.determineRole();
  expect(node.role).toBe(NodeRole.Leader);
  const res = node.getLeader();
  if (res === null) throw new Error('leader resources missing');
  attachLeaderEndpoints(res.http, {
    relay: res.relay,
    serverVersion: 'leader-1.0.0',
    buildId,
    onAbdicate: () => election.yieldLeadership(),
    abdicateQuietWindowMs: 0,
  });
  return { node, election };
};

describe('Election', () => {
  it('tick: leader does nothing', async () => {
    const port = await freePort();
    const h = await startLeaderHarness(port);
    const follower = new Follower({ leaderUrl: `http://127.0.0.1:${port}` });
    const election = new Election({ node: h.node, follower, tickIntervalMs: 1_000_000 });
    extraElections.push(election);
    await election.tickOnce();
    expect(h.node.role).toBe(NodeRole.Leader);
  });

  it('tick: healthy follower stays follower', async () => {
    const port = await freePort();
    await startLeaderHarness(port);
    const { node, election } = buildElection(port);
    await election.determineRole();
    expect(node.role).toBe(NodeRole.Follower);
    await election.tickOnce();
    expect(node.role).toBe(NodeRole.Follower);
  });

  it('tick: dead leader triggers takeover', async () => {
    const port = await freePort();
    const h = await startLeaderHarness(port);
    const { node, election } = buildElection(port);
    await election.determineRole();
    expect(node.role).toBe(NodeRole.Follower);

    h.detach();
    await h.relay.stop();
    h.http.closeAllConnections();
    await new Promise<void>(resolve => h.http.close(() => resolve()));
    harnesses.length = 0;

    await election.tickOnce();
    expect(node.role).toBe(NodeRole.Leader);
    expect(node.getLeader()?.port).toBe(port);
  });

  it('determineRole: free port → leader', async () => {
    const port = await freePort();
    const { node, election } = buildElection(port);
    await election.determineRole();
    expect(node.role).toBe(NodeRole.Leader);
  });

  it('determineRole: port taken by responsive leader → follower', async () => {
    const port = await freePort();
    await startLeaderHarness(port);
    const { node, election } = buildElection(port);
    await election.determineRole();
    expect(node.role).toBe(NodeRole.Follower);
  });

  it('determineRole: port held by a non-Figwright process → conflicted, not follower', async () => {
    const port = await freePort();
    const blocker = createServer();
    await new Promise<void>(resolve => blocker.listen(port, '127.0.0.1', () => resolve()));
    blockers.push(blocker);
    const { node, election } = buildElection(port, 100);
    await election.determineRole();
    // The squatter answers no Figwright /ping, so we must NOT attach as its follower (that would
    // forward every RPC into a wall). Stay conflicted and keep contending.
    expect(node.role).toBe(NodeRole.Conflicted);
  });

  it('tick: conflicted node takes the port once the squatter releases it', async () => {
    const port = await freePort();
    const blocker = createServer();
    await new Promise<void>(resolve => blocker.listen(port, '127.0.0.1', () => resolve()));
    const { node, election } = buildElection(port, 100);
    await election.determineRole();
    expect(node.role).toBe(NodeRole.Conflicted);

    // Squatter goes away → the next tick should bind the freed port and lead.
    await new Promise<void>(resolve => blocker.close(() => resolve()));
    await election.tickOnce();
    expect(node.role).toBe(NodeRole.Leader);
  });

  it('tick: conflicted node follows once a real Figwright leader takes the port', async () => {
    const port = await freePort();
    const blocker = createServer();
    await new Promise<void>(resolve => blocker.listen(port, '127.0.0.1', () => resolve()));
    const { node, election } = buildElection(port, 100);
    await election.determineRole();
    expect(node.role).toBe(NodeRole.Conflicted);

    // Squatter leaves and a real Figwright leader takes the port → next tick resolves to follower.
    await new Promise<void>(resolve => blocker.close(() => resolve()));
    await startLeaderHarness(port);
    await election.tickOnce();
    expect(node.role).toBe(NodeRole.Follower);
  });

  it('start() runs determineRole and stop() halts ticker', async () => {
    const port = await freePort();
    await startLeaderHarness(port);
    const { node, election } = buildElection(port);
    await election.start();
    expect(node.role).toBe(NodeRole.Follower);
    election.stop();
  });
});

describe('Election: newest build wins (abdication)', () => {
  it('a follower on a newer build takes over from a stale leader, which stays demoted', async () => {
    const port = await freePort();
    const old = await startLeaderWithElection(port, 100);
    const { node, election } = buildElection(port, 200, 200);

    await election.determineRole();
    expect(node.role).toBe(NodeRole.Follower);

    // One tick: leaderInfo shows an older build → request abdication → grab the released port.
    await election.tickOnce();
    expect(node.role).toBe(NodeRole.Leader);
    expect(node.getLeader()?.port).toBe(port);
    expect(old.node.role).toBe(NodeRole.Follower);

    // The demoted old leader's own tick must not challenge back or re-take the port.
    await old.election.tickOnce();
    expect(old.node.role).toBe(NodeRole.Follower);
    expect(node.role).toBe(NodeRole.Leader);
  });

  it('equal builds never challenge', async () => {
    const port = await freePort();
    const old = await startLeaderWithElection(port, 100);
    const { node, election } = buildElection(port, 200, 100);
    await election.determineRole();
    await election.tickOnce();
    expect(node.role).toBe(NodeRole.Follower);
    expect(old.node.role).toBe(NodeRole.Leader);
  });

  it('a busy leader defers the handoff (challenger retries on later ticks)', async () => {
    const port = await freePort();
    const old = await startLeaderWithElection(port, 100);
    // No plugin connected → the request stays pending, so the leader reports busy.
    const pending = old.node
      .getLeader()
      ?.relay.sendRequest('slow_tool', {}, 1_500)
      .catch(() => {});
    const { node, election } = buildElection(port, 200, 200);
    await election.determineRole();
    await election.tickOnce();
    expect(node.role).toBe(NodeRole.Follower);
    expect(old.node.role).toBe(NodeRole.Leader);
    await pending;
  });

  it('a pre-abdication leader stays; the challenger backs off instead of spamming', async () => {
    const port = await freePort();
    // startLeaderHarness attaches endpoints without buildId/onAbdicate — the old-release shape.
    await startLeaderHarness(port);
    const logs: string[] = [];
    const { node, election } = buildElection(port, 200, 200, msg => logs.push(msg));
    await election.determineRole();

    await election.tickOnce();
    await election.tickOnce();
    expect(node.role).toBe(NodeRole.Follower);
    const manualRetirements = logs.filter(l => l.includes('retired manually')).length;
    expect(manualRetirements).toBe(1);
  });

  it('yieldLeadership opens a window where the ex-leader will not re-take the free port', async () => {
    const port = await freePort();
    const old = await startLeaderWithElection(port, 100);
    old.election.yieldLeadership();
    expect(old.node.role).toBe(NodeRole.Follower);

    // The port is now free and the leader ping fails, but the yield window holds takeover back.
    await old.election.tickOnce();
    expect(old.node.role).toBe(NodeRole.Follower);
  });

  it('yieldLeadership is a no-op unless leading', async () => {
    const port = await freePort();
    const { node, election } = buildElection(port, 200, 100);
    election.yieldLeadership();
    expect(node.role).toBe(NodeRole.Unknown);
  });

  it('overlapping ticks coalesce — a second tick while one is in flight is a no-op', async () => {
    const port = await freePort();
    // No leader on the port: each real tick tries a takeover. Overlap is realistic because a
    // tick can outlive the 1s interval (ping timeout 2s, grab loop ~1s).
    const node = new Node({ serverVersion: 'x', port });
    extraNodes.push(node);
    let pings = 0;
    const follower = {
      ping: async () => {
        pings += 1;
        await new Promise(r => setTimeout(r, 50));
        return false;
      },
      leaderInfo: async () => {
        pings += 1;
        await new Promise(r => setTimeout(r, 50));
        return undefined;
      },
      requestAbdication: async () => 'error' as const,
    } as unknown as Follower;
    const election = new Election({ node, follower, tickIntervalMs: 1_000_000 });
    extraElections.push(election);
    node.becomeFollower();

    // Fire two ticks concurrently: the second must return without probing the leader again.
    await Promise.all([election.tickOnce(), election.tickOnce()]);
    expect(pings).toBe(1);
    expect(node.role).toBe(NodeRole.Leader);
  });
});
