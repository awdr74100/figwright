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
): { node: Node; election: Election; follower: Follower } => {
  const node = new Node({ serverVersion: 'challenger-1.0.0', port });
  extraNodes.push(node);
  const follower = new Follower({
    leaderUrl: `http://127.0.0.1:${port}`,
    pingTimeoutMs,
  });
  const election = new Election({ node, follower, tickIntervalMs: 1_000_000 });
  extraElections.push(election);
  return { node, election, follower };
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
