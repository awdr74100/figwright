import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { leaderLockPath } from '../../src/election/leader-lock.js';

// The crash guard, end to end: a real built server, made to misbehave from inside its own process,
// must keep serving its client and keep stdout pure JSON-RPC. Unit tests cover each part; this is
// what proves the parts are installed, and installed before anything else runs.
const DIST_ENTRY = join(import.meta.dirname, '..', '..', 'dist', 'index.mjs');
const MISBEHAVE = pathToFileURL(join(import.meta.dirname, 'fixtures', 'misbehave.mjs')).href;

const freePort = async (): Promise<number> => {
  const s = createServer();
  await new Promise<void>(resolve => s.listen(0, '127.0.0.1', () => resolve()));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>(resolve => s.close(() => resolve()));
  return port;
};

describe.skipIf(!existsSync(DIST_ENTRY))('process guard (built dist)', () => {
  it('keeps serving through an uncaught exception, an unhandled rejection and a stray console write', async () => {
    const port = await freePort();
    const child = spawn(process.execPath, ['--import', MISBEHAVE, DIST_ENTRY], {
      env: { ...process.env, FIGWRIGHT_PORT: String(port) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    const responses = new Map<number, unknown>();
    const send = async (id: number, method: string, params: object = {}): Promise<unknown> => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      for (let waited = 0; waited < 10_000; waited += 50) {
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(
            `server exited (${child.exitCode ?? child.signalCode})\nstderr:\n${stderr}`,
          );
        }
        for (const line of stdout.split('\n')) {
          if (line.trim() === '') continue;
          const msg = JSON.parse(line) as { id?: number };
          if (msg.id !== undefined) responses.set(msg.id, msg);
        }
        if (responses.has(id)) return responses.get(id);
        // eslint-disable-next-line no-await-in-loop -- poll the child's output
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error(`no response to ${method}\nstderr:\n${stderr}`);
    };

    let exitCode: number | null = null;
    try {
      await send(1, 'initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'process-guard-test', version: '0' },
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
      );

      // Give the preload's misbehaviour time to happen, then use the server.
      for (
        let waited = 0;
        !stderr.includes('exception nobody caught') && waited < 5_000;
        waited += 50
      ) {
        // eslint-disable-next-line no-await-in-loop -- wait for the misbehaviour to land
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      const listed = (await send(2, 'tools/list')) as { result?: { tools?: unknown[] } };
      expect(listed.result?.tools?.length).toBeGreaterThan(0);
      const pinged = (await send(3, 'tools/call', { name: 'ping', arguments: {} })) as {
        result?: unknown;
      };
      expect(pinged.result).toBeDefined();

      expect(child.exitCode).toBeNull();
      // Every line on stdout is protocol; the console write went to stderr.
      for (const line of stdout.split('\n').filter(l => l.trim() !== '')) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
      expect(stderr).toContain('stray console output');
      expect(stderr).toMatch(/unhandled rejection — kept running: Error: rejection nobody handled/);
      expect(stderr).toMatch(/uncaught exception — kept running: Error: exception nobody caught/);
    } finally {
      rmSync(leaderLockPath(port), { force: true });
      // A server that already died is reported by the assertions above; only a live one is asked
      // to leave, and the guard must not have taken away its ordinary exit when the client goes.
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.stdin.end();
        [exitCode] = (await exited) as [number | null];
      }
    }
    expect(exitCode).toBe(0);
  }, 30_000);
});
