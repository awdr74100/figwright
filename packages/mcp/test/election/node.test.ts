import { createServer, type Server as HttpServer } from 'node:http';
import { type AddressInfo, connect as netConnect, type Socket } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { isAddressInUse, Node, NodeRole } from '../../src/election/node.js';

const blockers: HttpServer[] = [];
const nodes: Node[] = [];
const sockets: Socket[] = [];

// Open a connection to the leader with an HTTP request in flight that nothing will ever answer
// (the bare leader http server has no request listener in these tests). Node ≥19's server.close()
// closes *idle* connections itself, so only an in-flight request reproduces the hang these
// regression tests pin down.
const connectWithInflightRequest = async (port: number): Promise<Socket> => {
  const sock = netConnect(port, '127.0.0.1');
  sockets.push(sock);
  await new Promise<void>((resolve, reject) => {
    sock.once('connect', resolve);
    sock.once('error', reject);
  });
  sock.write('GET /never-answered HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');
  // Give the server a beat to parse the request so the connection counts as in-flight.
  await new Promise<void>(resolve => setTimeout(resolve, 30));
  return sock;
};

const blockPort = async (port: number): Promise<void> => {
  const s = createServer();
  await new Promise<void>(resolve => s.listen(port, '127.0.0.1', () => resolve()));
  blockers.push(s);
};

const freePort = async (): Promise<number> => {
  const s = createServer();
  await new Promise<void>(resolve => s.listen(0, '127.0.0.1', () => resolve()));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>(resolve => s.close(() => resolve()));
  return port;
};

afterEach(async () => {
  for (const s of sockets) s.destroy();
  sockets.length = 0;
  await Promise.all(nodes.map(n => n.stop()));
  nodes.length = 0;
  await Promise.all(blockers.map(s => new Promise<void>(r => s.close(() => r()))));
  blockers.length = 0;
});

const makeNode = (port: number): Node => {
  const n = new Node({ serverVersion: 'test-1.0.0', port });
  nodes.push(n);
  return n;
};

describe('Node role state machine', () => {
  it('starts in Unknown role', () => {
    const n = makeNode(0);
    expect(n.role).toBe(NodeRole.Unknown);
    expect(n.isLeader()).toBe(false);
    expect(n.isFollower()).toBe(false);
  });

  it('becomeLeader binds the port and exposes Relay', async () => {
    const port = await freePort();
    const n = makeNode(port);
    const res = await n.becomeLeader();
    expect(n.role).toBe(NodeRole.Leader);
    expect(n.isLeader()).toBe(true);
    expect(res.port).toBe(port);
    expect(n.getLeader()).toBe(res);
    expect(n.leaderUrl).toBe(`http://127.0.0.1:${port}`);
  });

  it('becomeLeader is idempotent', async () => {
    const port = await freePort();
    const n = makeNode(port);
    const a = await n.becomeLeader();
    const b = await n.becomeLeader();
    expect(b).toBe(a);
  });

  it('becomeLeader throws EADDRINUSE when port is taken', async () => {
    const port = await freePort();
    await blockPort(port);
    const n = makeNode(port);
    let caught: unknown;
    try {
      await n.becomeLeader();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(isAddressInUse(caught)).toBe(true);
    expect(n.role).toBe(NodeRole.Unknown);
    expect(n.getLeader()).toBe(null);
  });

  it('becomeFollower transitions from Unknown', () => {
    const n = makeNode(0);
    n.becomeFollower();
    expect(n.role).toBe(NodeRole.Follower);
    expect(n.isFollower()).toBe(true);
    expect(n.getLeader()).toBe(null);
  });

  it('becomeFollower from Leader closes leader resources', async () => {
    const port = await freePort();
    const n = makeNode(port);
    const res = await n.becomeLeader();
    n.becomeFollower();
    expect(n.role).toBe(NodeRole.Follower);
    expect(n.getLeader()).toBe(null);
    await new Promise(r => setTimeout(r, 20));
    expect(res.http.listening).toBe(false);
  });

  it('fires role-change listeners on transitions', async () => {
    const port = await freePort();
    const n = makeNode(port);
    const seen: NodeRole[] = [];
    n.onRoleChange(r => seen.push(r));
    await n.becomeLeader();
    n.becomeFollower();
    expect(seen).toEqual([NodeRole.Leader, NodeRole.Follower]);
  });

  // Regression: http.close() waits for in-flight requests to finish before its callback fires. A
  // follower /rpc that lands in the shutdown window sits on a stopped relay until its tool budget
  // (up to minutes) expires, so a shutting-down leader lingers that whole time as a zombie — still
  // answering /ping on live connections, so no follower takes over. stop must sever connections,
  // not wait them out.
  it('stop resolves even while a connection has a request in flight', async () => {
    const port = await freePort();
    const n = makeNode(port);
    await n.becomeLeader();
    await connectWithInflightRequest(port);
    await n.stop();
    expect(n.role).toBe(NodeRole.Unknown);
  });

  it('becomeFollower severs in-flight connections to the demoted leader', async () => {
    const port = await freePort();
    const n = makeNode(port);
    await n.becomeLeader();
    const sock = await connectWithInflightRequest(port);
    const closed = new Promise<void>(resolve => sock.once('close', () => resolve()));
    n.becomeFollower();
    await closed;
    expect(n.role).toBe(NodeRole.Follower);
  });

  it('stop releases the bound port so it can be re-bound', async () => {
    const port = await freePort();
    const n = makeNode(port);
    await n.becomeLeader();
    await n.stop();
    expect(n.role).toBe(NodeRole.Unknown);

    const n2 = makeNode(port);
    await expect(n2.becomeLeader()).resolves.toBeDefined();
  });
});
