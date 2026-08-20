import { rmSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { Election, WEDGED_UNRESPONSIVE_TICKS } from '../../src/election/election.js';
import { Follower } from '../../src/election/follower.js';
import { attachLeaderEndpoints } from '../../src/election/leader-endpoints.js';
import {
  leaderLockPath,
  type ProcessProbe,
  readLeaderLock,
  writeLeaderLock,
} from '../../src/election/leader-lock.js';
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
const lockedPorts: number[] = [];

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
  for (const port of lockedPorts) rmSync(leaderLockPath(port), { force: true });
  lockedPorts.length = 0;
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
  probe?: ProcessProbe,
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
    ...(probe === undefined ? {} : { probe }),
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

/**
 * The wedged leader: alive, still holding the port, no longer answering. Simulated by detaching the
 * leader's endpoints while leaving its http server bound — the same thing an observer sees from a
 * SIGSTOPped process, and the one shape the election cannot resolve by waiting, because "the leader
 * is dead" is decided by a failed /ping while taking over needs the port actually released.
 */
describe('Election: a leader that holds the port but stops answering', () => {
  const wedge = (h: LeaderHarness): void => {
    h.detach();
  };

  /** A probe that reports one pid with a chosen state, and records every SIGCONT. */
  const probeFor = (
    pid: number,
    state: string,
    startedAt: number,
  ): ProcessProbe & { resumed: number[] } => {
    const resumed: number[] = [];
    return {
      resumed,
      inspect: p => (p === pid ? { state, startedAt } : undefined),
      resume: p => {
        resumed.push(p);
        return true;
      },
    };
  };

  const lockPortToThisProcess = (port: number): number => {
    lockedPorts.push(port);
    writeLeaderLock({ port, buildId: 7, serverVersion: 'wedged-1.0.0' });
    return readLeaderLock(port)!.processStartedAt;
  };

  it('stays a follower until the threshold, then declares the conflict', async () => {
    const port = await freePort();
    const h = await startLeaderHarness(port);
    const { node, election } = buildElection(port);
    await election.determineRole();
    expect(node.role).toBe(NodeRole.Follower);

    wedge(h);

    // One silent tick is the ordinary handoff race, not a wedge — tripping on it would turn every
    // leadership change into a conflict. Nothing may change until the last tick of the run.
    for (let i = 0; i < WEDGED_UNRESPONSIVE_TICKS - 1; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- ticks are sequential by definition
      await election.tickOnce();
      expect(node.role).toBe(NodeRole.Follower);
    }
    await election.tickOnce();
    expect(node.role).toBe(NodeRole.Conflicted);
  });

  it('resets the count when the leader answers again, so intermittent stalls never trip it', async () => {
    const port = await freePort();
    const h = await startLeaderHarness(port);
    const { node, election } = buildElection(port);
    await election.determineRole();

    // Strictly more silent ticks than the threshold, so a count that never resets WOULD trip —
    // which is the only way this test can tell the reset apart from "not enough ticks yet".
    const silentTicks = WEDGED_UNRESPONSIVE_TICKS + 2;
    for (let i = 0; i < silentTicks; i += 1) {
      wedge(h);
      // eslint-disable-next-line no-await-in-loop -- ticks are sequential by definition
      await election.tickOnce();
      // Asserted here, on the silent tick itself. Checking only after the leader answers again
      // would prove nothing: the conflict state is self-healing, so a wrongly-declared conflict is
      // back to follower one tick later and leaves no trace to assert on.
      expect(node.role).toBe(NodeRole.Follower);
      h.detach = attachLeaderEndpoints(h.http, { relay: h.relay, serverVersion: 'leader-1.0.0' });
      // eslint-disable-next-line no-await-in-loop -- ticks are sequential by definition
      await election.tickOnce();
      expect(node.role).toBe(NodeRole.Follower);
    }
  });

  it('names the holding process in the message when the lock can be proved', async () => {
    const port = await freePort();
    const h = await startLeaderHarness(port);
    const startedAt = lockPortToThisProcess(port);
    const probe = probeFor(process.pid, 'S', startedAt);
    const { node, election } = buildElection(port, 200, 0, undefined, probe);
    await election.determineRole();
    wedge(h);

    for (let i = 0; i < WEDGED_UNRESPONSIVE_TICKS; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- ticks are sequential by definition
      await election.tickOnce();
    }
    expect(node.role).toBe(NodeRole.Conflicted);
    expect(node.conflictMessage).toContain(`pid ${process.pid}`);
    expect(node.conflictMessage).toContain('wedged-1.0.0');
    expect(node.conflictMessage).toContain(`kill ${process.pid}`);
    // Not suspended → nothing may be signalled.
    expect(probe.resumed).toEqual([]);
  });

  it('sends SIGCONT when the holder is suspended, and says so', async () => {
    const port = await freePort();
    const h = await startLeaderHarness(port);
    const startedAt = lockPortToThisProcess(port);
    const probe = probeFor(process.pid, 'T', startedAt);
    const { node, election } = buildElection(port, 200, 0, undefined, probe);
    await election.determineRole();
    wedge(h);

    for (let i = 0; i < WEDGED_UNRESPONSIVE_TICKS; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- ticks are sequential by definition
      await election.tickOnce();
    }
    expect(node.role).toBe(NodeRole.Conflicted);
    expect(probe.resumed).toEqual([process.pid]);
    expect(node.conflictMessage).toContain('SIGCONT was just sent');
  });

  it('falls back to the anonymous message when the holder cannot be proved', async () => {
    const port = await freePort();
    const h = await startLeaderHarness(port);
    // No lock written for this port, so there is nobody to name — and we must not guess.
    const { node, election } = buildElection(port);
    await election.determineRole();
    wedge(h);
    for (let i = 0; i < WEDGED_UNRESPONSIVE_TICKS; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- ticks are sequential by definition
      await election.tickOnce();
    }
    expect(node.role).toBe(NodeRole.Conflicted);
    expect(node.conflictMessage).not.toContain('pid');
    // The anonymous branch, named by what it offers instead of a pid — the shell command it
    // suggests is platform-specific and pinned in leader-lock's own tests.
    expect(node.conflictMessage).toContain('Free that port');
  });

  it('recovers to follower the moment the leader answers again, and drops the diagnosis', async () => {
    const port = await freePort();
    const h = await startLeaderHarness(port);
    const startedAt = lockPortToThisProcess(port);
    const { node, election } = buildElection(
      port,
      200,
      0,
      undefined,
      probeFor(process.pid, 'T', startedAt),
    );
    await election.determineRole();
    wedge(h);
    for (let i = 0; i < WEDGED_UNRESPONSIVE_TICKS; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- ticks are sequential by definition
      await election.tickOnce();
    }
    expect(node.role).toBe(NodeRole.Conflicted);

    // What a successful SIGCONT looks like from here: the holder starts answering again.
    h.detach = attachLeaderEndpoints(h.http, { relay: h.relay, serverVersion: 'leader-1.0.0' });
    await election.tickOnce();
    expect(node.role).toBe(NodeRole.Follower);
    expect(node.conflictMessage).not.toContain('pid');
  });

  it('identifies the holder on the cold-start path too', async () => {
    const port = await freePort();
    const h = await startLeaderHarness(port);
    const startedAt = lockPortToThisProcess(port);
    wedge(h);
    // A server launched *while* the leader is already wedged never gets to be a follower, so it
    // reaches the conflict through determineRole instead of the tick — and must diagnose it the same.
    const { node, election } = buildElection(
      port,
      200,
      0,
      undefined,
      probeFor(process.pid, 'T', startedAt),
    );
    await election.determineRole();
    expect(node.role).toBe(NodeRole.Conflicted);
    expect(node.conflictMessage).toContain(`pid ${process.pid}`);
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
