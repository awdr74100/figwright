import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  identifyPortHolder,
  leaderLockPath,
  osProcessProbe,
  PID_IDENTITY_TOLERANCE_MS,
  type PortHolder,
  portConflictMessage,
  type ProcessProbe,
  readLeaderLock,
  resumeStoppedHolder,
  writeLeaderLock,
} from '../../src/election/leader-lock.js';

// Ports here are only ever used as lock-file keys — nothing binds them — but the key space is
// shared with every other test file, and `election.test.ts` writes real notes keyed by the
// *ephemeral* ports `freePort()` hands it, from a different worker process. A range that overlaps
// the ephemeral one therefore collides for real: the earlier `41_000 + random * 20_000` crossed
// 49152-61000 on macOS, and a hit made `readLeaderLock` return the other worker's note, failing
// "is undefined when there is no lock for that port" — one test, at random, roughly once in a
// hundred runs. Reproduced deliberately before this was changed.
//
// 20_000 is below every platform's ephemeral floor (Linux 32768, macOS/Windows 49152), so no port
// any other file is handed can land here. The pid offset keeps two concurrent vitest runs on one
// machine apart as well.
let nextPort = 20_000 + (process.pid % 100) * 100;
const testPort = (): number => (nextPort += 1);

const written: number[] = [];
const children: ChildProcess[] = [];

afterEach(() => {
  for (const port of written) rmSync(leaderLockPath(port), { force: true });
  written.length = 0;
  for (const c of children) c.kill('SIGKILL');
  children.length = 0;
});

const writeLock = (port: number): void => {
  written.push(port);
  writeLeaderLock({ port, buildId: 42, serverVersion: '9.9.9' });
};

const writeRawLock = (port: number, body: string): void => {
  written.push(port);
  mkdirSync(dirname(leaderLockPath(port)), { recursive: true });
  writeFileSync(leaderLockPath(port), body);
};

/** A probe that answers for exactly one pid, so nothing here touches the real process table. */
const fakeProbe = (
  pid: number,
  live: { state: string; startedAt: number } | undefined,
  onResume?: (pid: number) => boolean,
): ProcessProbe & { resumed: number[] } => {
  const resumed: number[] = [];
  return {
    resumed,
    inspect: p => (p === pid ? live : undefined),
    resume: p => {
      resumed.push(p);
      return onResume?.(p) ?? true;
    },
  };
};

describe('leader lock: write / read', () => {
  it('round-trips this process as the port holder', () => {
    const port = testPort();
    writeLock(port);
    const lock = readLeaderLock(port);
    expect(lock).toBeDefined();
    expect(lock?.pid).toBe(process.pid);
    expect(lock?.port).toBe(port);
    expect(lock?.buildId).toBe(42);
    expect(lock?.serverVersion).toBe('9.9.9');
    // The recorded start must be this process's own, not "now" — a follower promoted an hour into
    // its life would otherwise record a time no `ps` will ever agree with, and could never be named.
    const selfStart = Date.now() - Math.round(process.uptime() * 1_000);
    expect(Math.abs((lock?.processStartedAt ?? 0) - selfStart)).toBeLessThan(2_000);
  });

  it('records the start time the reader will compare against, from the same source', () => {
    // The invariant that makes the identity check exact rather than approximate: writer and reader
    // read one clock. `Date.now() - process.uptime()` is usually within a second of it, but the two
    // drift apart across a system sleep or an NTP step — silently, and towards "unidentified".
    const port = testPort();
    written.push(port);
    const probe = fakeProbe(process.pid, { state: 'S', startedAt: 1_600_000_000_123 });
    writeLeaderLock({ port, buildId: 1, serverVersion: 'x' }, probe);
    expect(readLeaderLock(port)?.processStartedAt).toBe(1_600_000_000_123);
  });

  it('falls back to the uptime form only where the process table cannot be read', () => {
    const port = testPort();
    written.push(port);
    const blind: ProcessProbe = { inspect: () => undefined, resume: () => false };
    writeLeaderLock({ port, buildId: 1, serverVersion: 'x' }, blind);
    const selfStart = Date.now() - Math.round(process.uptime() * 1_000);
    expect(Math.abs((readLeaderLock(port)?.processStartedAt ?? 0) - selfStart)).toBeLessThan(2_000);
  });

  it('keys its notes below every platform ephemeral range, so no other file can collide', () => {
    // The invariant that closes the cross-worker race, pinned so an edit cannot quietly undo it:
    // other files key their notes by ports `freePort()` hands them, which start at 32768 (Linux)
    // and 49152 (macOS/Windows).
    for (let i = 0; i < 50; i += 1) expect(testPort()).toBeLessThan(32_768);
  });

  it('is undefined when there is no lock for that port', () => {
    // Asserting an absence means guaranteeing it: a crashed earlier run can leave a note at this
    // key, and the assertion would then be reporting that leftover rather than the behaviour.
    const port = testPort();
    rmSync(leaderLockPath(port), { force: true });
    expect(readLeaderLock(port)).toBeUndefined();
  });

  it.each([
    ['malformed json', '{not json'],
    ['not an object', '"a string"'],
    ['missing pid', JSON.stringify({ port: 1, serverVersion: 'x', processStartedAt: 1 })],
    ['non-integer pid', JSON.stringify({ pid: 1.5, serverVersion: 'x', processStartedAt: 1 })],
    ['zero pid', JSON.stringify({ pid: 0, serverVersion: 'x', processStartedAt: 1 })],
    ['no start time', JSON.stringify({ pid: 10, serverVersion: 'x' })],
  ])('rejects a lock with %s', (_label, body) => {
    const port = testPort();
    writeRawLock(port, body.replace('"port":1', `"port":${port}`));
    expect(readLeaderLock(port)).toBeUndefined();
  });

  it("rejects a lock whose port isn't the one being asked about", () => {
    const port = testPort();
    writeRawLock(
      port,
      JSON.stringify({ pid: 10, port: port + 1, serverVersion: 'x', processStartedAt: 1 }),
    );
    expect(readLeaderLock(port)).toBeUndefined();
  });
});

describe('leader lock: identifying the holder', () => {
  it('confirms a live process whose start time matches the lock', () => {
    const port = testPort();
    writeLock(port);
    const lock = readLeaderLock(port)!;
    const probe = fakeProbe(process.pid, { state: 'S', startedAt: lock.processStartedAt });
    const holder = identifyPortHolder(port, probe);
    expect(holder).toEqual({
      pid: process.pid,
      buildId: 42,
      serverVersion: '9.9.9',
      stopped: false,
      resumed: false,
    });
  });

  it('refuses a recycled pid: same pid, different start time', () => {
    const port = testPort();
    writeLock(port);
    const lock = readLeaderLock(port)!;
    // Just outside the tolerance — the pid exists, but it is not the process that wrote the lock.
    // Naming it would tell the user to kill an innocent (plausibly a healthy Figwright server).
    const probe = fakeProbe(process.pid, {
      state: 'S',
      startedAt: lock.processStartedAt + PID_IDENTITY_TOLERANCE_MS + 1,
    });
    expect(identifyPortHolder(port, probe)).toBeUndefined();
  });

  it('accepts a start time inside the tolerance (ps reports whole seconds)', () => {
    const port = testPort();
    writeLock(port);
    const lock = readLeaderLock(port)!;
    const probe = fakeProbe(process.pid, {
      state: 'S',
      startedAt: lock.processStartedAt - PID_IDENTITY_TOLERANCE_MS,
    });
    expect(identifyPortHolder(port, probe)?.pid).toBe(process.pid);
  });

  it('is undefined when the pid is gone', () => {
    const port = testPort();
    writeLock(port);
    expect(identifyPortHolder(port, fakeProbe(process.pid, undefined))).toBeUndefined();
  });

  it('is undefined when there is no lock at all', () => {
    const port = testPort();
    rmSync(leaderLockPath(port), { force: true });
    const probe = fakeProbe(process.pid, { state: 'T', startedAt: Date.now() });
    expect(identifyPortHolder(port, probe)).toBeUndefined();
  });

  it.each([
    ['T', true],
    ['T+', true],
    ['S', false],
    ['R', false],
    ['S+', false],
  ])('reads process state %s as stopped=%s', (state, stopped) => {
    const port = testPort();
    writeLock(port);
    const lock = readLeaderLock(port)!;
    const probe = fakeProbe(process.pid, { state, startedAt: lock.processStartedAt });
    expect(identifyPortHolder(port, probe)?.stopped).toBe(stopped);
  });
});

describe('leader lock: resuming a suspended holder', () => {
  const holder = (over: Partial<PortHolder> = {}): PortHolder => ({
    pid: 4321,
    buildId: 1,
    serverVersion: '1.0.0',
    stopped: false,
    resumed: false,
    ...over,
  });

  it('signals only a stopped holder', () => {
    const probe = fakeProbe(4321, undefined);
    expect(resumeStoppedHolder(holder({ stopped: false }), probe).resumed).toBe(false);
    expect(probe.resumed).toEqual([]);
  });

  it('sends SIGCONT to a stopped holder and records that it went out', () => {
    const probe = fakeProbe(4321, undefined);
    expect(resumeStoppedHolder(holder({ stopped: true }), probe).resumed).toBe(true);
    expect(probe.resumed).toEqual([4321]);
  });

  it('records a failed signal as not resumed', () => {
    const probe = fakeProbe(4321, undefined, () => false);
    expect(resumeStoppedHolder(holder({ stopped: true }), probe).resumed).toBe(false);
  });
});

describe('leader lock: the message', () => {
  it('does not claim the holder is non-Figwright when it could not be identified', () => {
    const msg = portConflictMessage(3055);
    expect(msg).toContain('3055');
    // Platform-neutral: which shell command the remedy names is asserted per platform below.
    expect(msg).toContain('Free that port');
    // The old wording asserted the holder was "a non-Figwright process" — an assertion nothing
    // could support, and exactly wrong for the case this whole file exists for (a Figwright leader
    // that stopped answering). Unidentified must read as unidentified.
    expect(msg).not.toContain('non-Figwright');
    expect(msg).not.toContain('pid');
  });

  it('names the pid and the kill command for an identified holder', () => {
    const msg = portConflictMessage(3055, {
      pid: 777,
      buildId: 1,
      serverVersion: '0.4.0',
      stopped: false,
      resumed: false,
    });
    expect(msg).toContain('pid 777');
    expect(msg).toContain('v0.4.0');
    expect(msg).toContain('kill 777');
    expect(msg).not.toContain('SIGCONT');
  });

  it('mentions SIGCONT only when one was actually sent', () => {
    const stopped = { pid: 777, buildId: 1, serverVersion: '0.4.0', stopped: true };
    expect(portConflictMessage(3055, { ...stopped, resumed: true })).toContain(
      'SIGCONT was just sent',
    );
    const notResumed = portConflictMessage(3055, { ...stopped, resumed: false });
    expect(notResumed).toContain('could not be resumed');
    expect(notResumed).not.toContain('SIGCONT was just sent');
  });
});

// Windows reaches exactly one path: nothing is ever identified, nothing is ever signalled, and the
// anonymous message is the only thing a user there will ever see. That cannot be verified on a real
// Windows box from here, so the next best thing is to force the branch and assert the whole
// degradation chain — that the guards hold *before* the OS calls, not that the OS calls fail.
describe('leader lock: the Windows branch', () => {
  const realPlatform = process.platform;
  // Both directions are stubbed, so each branch is asserted on every host. Asserting the POSIX
  // branch by *being* on POSIX is what the first Windows CI run caught: the production message was
  // right there (`netstat`), and the test that assumed otherwise was the thing that failed.
  const asPlatform = (value: NodeJS.Platform): void => {
    Object.defineProperty(process, 'platform', { value, configurable: true });
  };
  const asWindows = (): void => asPlatform('win32');
  const asPosix = (): void => asPlatform('linux');

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
  });

  it('never shells out to ps, and never signals', () => {
    asWindows();
    // A pid that certainly exists — this process. On a POSIX host the probe would answer for it, so
    // an undefined here can only come from the platform guard, not from a failed lookup.
    expect(osProcessProbe.inspect(process.pid)).toBeUndefined();
    expect(osProcessProbe.resume(process.pid)).toBe(false);
  });

  it('still writes a usable note, falling back to the uptime clock', () => {
    asWindows();
    const port = testPort();
    written.push(port);
    writeLeaderLock({ port, buildId: 3, serverVersion: 'win' });
    const lock = readLeaderLock(port);
    expect(lock?.pid).toBe(process.pid);
    const selfStart = Date.now() - Math.round(process.uptime() * 1_000);
    expect(Math.abs((lock?.processStartedAt ?? 0) - selfStart)).toBeLessThan(2_000);
  });

  it('never identifies a holder, so it can never name a pid to kill', () => {
    asWindows();
    const port = testPort();
    written.push(port);
    writeLeaderLock({ port, buildId: 3, serverVersion: 'win' });
    expect(identifyPortHolder(port)).toBeUndefined();
  });

  it('gives the remedy in a shell Windows actually has', () => {
    asWindows();
    const msg = portConflictMessage(3055);
    expect(msg).toContain('netstat -ano | findstr :3055');
    expect(msg).not.toContain('lsof');
  });

  it('gives the POSIX remedy everywhere else', () => {
    asPosix();
    const msg = portConflictMessage(3055);
    expect(msg).toContain('lsof -iTCP:3055 -sTCP:LISTEN');
    expect(msg).not.toContain('netstat');
  });
});

// The probe is the half that talks to the OS, so a fake can't prove it works. Everything above
// would still pass with `ps` misparsed or SIGCONT never delivered.
describe.skipIf(process.platform === 'win32')('leader lock: the real OS probe', () => {
  const spawnIdle = async (): Promise<ChildProcess> => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    children.push(child);
    await new Promise<void>(resolve => setTimeout(resolve, 400));
    return child;
  };

  it('reads a live process, and its start time agrees with the lock format', async () => {
    const child = await spawnIdle();
    const live = osProcessProbe.inspect(child.pid!);
    expect(live).toBeDefined();
    expect(live?.state).toMatch(/^[A-Z]/);
    // Same comparison identifyPortHolder makes, against a start time we know independently.
    expect(Math.abs((live?.startedAt ?? 0) - Date.now())).toBeLessThan(30_000);
  });

  it('sees a suspended process as stopped, and SIGCONT brings it back', async () => {
    const child = await spawnIdle();
    const pid = child.pid!;
    expect(osProcessProbe.inspect(pid)?.state.startsWith('T')).toBe(false);

    process.kill(pid, 'SIGSTOP');
    await new Promise<void>(resolve => setTimeout(resolve, 200));
    expect(osProcessProbe.inspect(pid)?.state.startsWith('T')).toBe(true);

    expect(osProcessProbe.resume(pid)).toBe(true);
    await new Promise<void>(resolve => setTimeout(resolve, 200));
    expect(osProcessProbe.inspect(pid)?.state.startsWith('T')).toBe(false);
  });

  it('is undefined for a pid that no longer exists', async () => {
    const child = await spawnIdle();
    const pid = child.pid!;
    child.kill('SIGKILL');
    await new Promise<void>(resolve => setTimeout(resolve, 300));
    expect(osProcessProbe.inspect(pid)).toBeUndefined();
  });

  it.each([0, -1, 1.5, Number.NaN])('refuses to probe or signal pid %s', pid => {
    expect(osProcessProbe.inspect(pid)).toBeUndefined();
    expect(osProcessProbe.resume(pid)).toBe(false);
  });

  it('identifies this very process end-to-end, through the real probe', () => {
    const port = testPort();
    writeLock(port);
    const holder = identifyPortHolder(port);
    expect(holder?.pid).toBe(process.pid);
    expect(holder?.stopped).toBe(false);
    // Writer and reader took the start time from the same `ps` call, so it is an exact match here,
    // not a match within the tolerance. The tolerance only ever covers the no-`ps` fallback.
    expect(readLeaderLock(port)?.processStartedAt).toBe(
      osProcessProbe.inspect(process.pid)?.startedAt,
    );
  });
});
