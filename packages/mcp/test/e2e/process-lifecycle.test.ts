import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

// Process-level proof of the zombie fixes: real spawned servers (the built dist), a real stdin
// EOF, and a real election takeover — the layers no in-process test exercises (process.exit
// wiring, undici keep-alive followers, the OS port release). Runs against dist, so it needs a
// build first; CI always builds before testing, and locally it skips instead of failing when the
// artifact is missing.
const DIST_ENTRY = join(import.meta.dirname, '..', '..', 'dist', 'index.mjs');

const freePort = async (): Promise<number> => {
  const s = createServer();
  await new Promise<void>(resolve => s.listen(0, '127.0.0.1', () => resolve()));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>(resolve => s.close(() => resolve()));
  return port;
};

interface Server {
  child: ChildProcess;
  stderr: () => string;
  exited: () => { code: number | null } | null;
}

const servers: Server[] = [];

afterEach(() => {
  for (const s of servers) {
    if (s.exited() === null) s.child.kill('SIGKILL');
  }
  servers.length = 0;
});

const spawnServer = (port: number): Server => {
  const child = spawn(process.execPath, [DIST_ENTRY], {
    env: { ...process.env, FIGWRIGHT_PORT: String(port) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString('utf8');
  });
  let exit: { code: number | null } | null = null;
  child.on('exit', code => {
    exit = { code };
  });
  // Once the server exits, writing to its stdin raises EPIPE. Tests here deliberately provoke that.
  child.stdin?.on('error', () => {});
  const s: Server = { child, stderr: () => stderr, exited: () => exit };
  servers.push(s);
  return s;
};

const waitFor = async (pred: () => boolean, label: string, timeoutMs: number): Promise<void> => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    // eslint-disable-next-line no-await-in-loop -- polling loop
    await new Promise<void>(resolve => setTimeout(resolve, 25));
  }
};

describe.skipIf(!existsSync(DIST_ENTRY))('process lifecycle (built dist)', () => {
  it(
    'leader exits promptly on stdin EOF and a live follower takes over the port',
    { timeout: 20_000 },
    async () => {
      const port = await freePort();

      const leader = spawnServer(port);
      await waitFor(() => leader.stderr().includes('ready as leader'), 'leader ready', 8_000);

      const follower = spawnServer(port);
      await waitFor(() => follower.stderr().includes('ready as follower'), 'follower ready', 8_000);

      // Let the follower run a few election ticks so its keep-alive /ping connection to the leader
      // is live — the exact connection that used to pin a shutting-down leader open.
      await new Promise<void>(resolve => setTimeout(resolve, 1_500));

      // The MCP client goes away: stdin EOF. The leader must fully exit (not just stop serving) —
      // before the closeAllConnections/hardExit fixes it could linger holding its followers.
      leader.child.stdin?.end();
      await waitFor(() => leader.exited() !== null, 'leader exit after stdin EOF', 8_000);
      expect(leader.exited()?.code).toBe(0);

      // With the dead leader's connections severed, the follower's next tick must fail its ping
      // and win the port.
      await waitFor(() => follower.stderr().includes('became LEADER'), 'follower takeover', 8_000);
      expect(follower.exited()).toBeNull();

      // And the promoted process itself dies cleanly when its client goes away.
      follower.child.stdin?.end();
      await waitFor(() => follower.exited() !== null, 'promoted follower exit', 8_000);
      expect(follower.exited()?.code).toBe(0);
    },
  );

  it(
    'exits and frees the port when the transport dies under it, and a follower takes over',
    { timeout: 20_000 },
    async () => {
      // The third way to lose the client, and the one nothing covered. A read that fails fatally —
      // reachable today because import_image carries base64 bytes as an *input* — makes the SDK
      // close the transport. Closing detaches the stdin listeners and pauses the stream without
      // ending it, so no 'end'/'close' fires and the process survives as a leader that can no
      // longer hear anyone, still holding the relay port. Before this was wired, a follower waited
      // behind it forever and the user had to kill the process by hand.
      const port = await freePort();

      const leader = spawnServer(port);
      await waitFor(() => leader.stderr().includes('ready as leader'), 'leader ready', 8_000);
      const follower = spawnServer(port);
      await waitFor(() => follower.stderr().includes('ready as follower'), 'follower ready', 8_000);

      const send = (msg: unknown): void => {
        leader.child.stdin?.write(`${JSON.stringify(msg)}\n`, () => {});
      };
      send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'transport-death', version: '0' },
        },
      });
      await new Promise<void>(resolve => setTimeout(resolve, 500));

      // One inbound message past the transport's 10 MB read buffer.
      send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'import_image',
          arguments: { data: 'A'.repeat(12 * 1024 * 1024), x: 0, y: 0 },
        },
      });

      await waitFor(() => leader.exited() !== null, 'leader exit after transport death', 9_000);
      expect(leader.exited()?.code).toBe(0);
      // Silence is what made this unrecoverable in practice: the user saw a server that answered
      // nothing and no reason why.
      expect(leader.stderr()).toContain('stdio transport error');

      await waitFor(() => follower.stderr().includes('became LEADER'), 'follower takeover', 9_000);
      expect(follower.exited()).toBeNull();
    },
  );
});
