import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Who owns :port, for the one case the election cannot resolve on its own.
 *
 * Every other way a leader can fail ends with the port being released, so a follower's next tick
 * takes over and nothing has to be diagnosed. The exception is a leader that is **still alive,
 * still holding the port, and no longer answering** — a suspended process (Ctrl-Z on a
 * hand-launched server, `kill -STOP`, a debugger that stopped it), or one wedged some other way.
 * There the election's two halves deadlock by construction: "the leader is dead" is decided by a
 * failed `/ping`, but taking over needs the port actually released, and neither ever happens.
 * Measured before this existed: the follower retried in silence until the tool budget expired (88s
 * for a default-budget tool, ~6.5min for a heavy one), a newly opened plugin could not connect to
 * anyone, and only killing the process by hand recovered.
 *
 * A follower can see the deadlock (its `/ping` fails _and_ its takeover gets EADDRINUSE) but has no
 * way to learn _who_ is holding the port — the OS exposes no such lookup to Node. So the leader
 * leaves a note when it binds. The note is only ever read on that dead-end path.
 *
 * **The note is not trusted on its face.** Naming the wrong pid would be worse than naming none:
 * the whole point is to tell the user which process to kill, and a stale note plus a recycled pid
 * would point at an innocent — plausibly at a _healthy_ Figwright server. So the reader re-derives
 * identity from the OS: the pid must still exist, and its start time must match the one the note
 * recorded (`ps -o lstart=`, whole-second resolution, hence the tolerance). Pid reuse cannot
 * survive that check, because it would have to reproduce the same start second too. Anything that
 * fails to line up degrades to the anonymous message, never a guess.
 */
export interface LeaderLock {
  pid: number;
  port: number;
  buildId: number;
  serverVersion: string;
  /**
   * When the _process_ started, not when it took the port — the fact the identity check compares
   * against. **Read from the same source the reader will use** (`ps`), rather than computed as
   * `Date.now() - process.uptime()`, because those two can drift apart for a process that becomes
   * leader long after it launched: a laptop that slept in between, or an NTP step, moves the wall
   * clock without moving the monotonic one, and the note would then describe a start time no `ps`
   * agrees with. Measured sub-second on macOS and Linux for a freshly-started leader either way —
   * but a mismatch degrades silently to "unidentified", which is exactly the laptop this feature
   * exists for, so the two sides read one clock instead of two that are usually close.
   */
  processStartedAt: number;
}

/** A confirmed holder of :port: the note's pid, re-identified against the live process table. */
export interface PortHolder {
  pid: number;
  buildId: number;
  serverVersion: string;
  /** OS process state is `T` — the process is suspended, not merely slow. */
  stopped: boolean;
  /** A `SIGCONT` was sent to it (only ever when `stopped`). */
  resumed: boolean;
}

/**
 * `ps` reports the start time to the second, and the lock records sub-second precision, so the two
 * differ by up to a second even for the same process. Two seconds of slack covers that without
 * coming close to admitting a different process: a recycled pid would have to have started within
 * the same two-second window as the one that wrote the lock.
 */
export const PID_IDENTITY_TOLERANCE_MS = 2_000;

/** Injection seam for the two OS calls this module makes, so tests never spawn `ps` or signal. */
export interface ProcessProbe {
  /** Live process state + start time for a pid, or undefined if it's gone (or unreadable). */
  inspect: (pid: number) => { state: string; startedAt: number } | undefined;
  /** Send SIGCONT. Returns whether the signal was delivered. */
  resume: (pid: number) => boolean;
}

const LSTART = String.raw`\w{3}\s+\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4}`;
const PS_LINE = new RegExp(String.raw`^\s*(\S+)\s+(${LSTART})\s*$`);

/**
 * The real probe. `ps` is the only portable way to read another process's state and start time from
 * Node; there is no API for it. Windows has neither `ps` nor SIGSTOP, so the whole diagnosis is
 * skipped there and the anonymous message stands.
 *
 * `LC_ALL=C` pins the date format the regex expects — under another locale the parse fails, which
 * degrades to "unidentified", never to a wrong pid. The pid is validated as a positive integer
 * before it reaches the argument list, and there is no shell involved.
 */
export const osProcessProbe: ProcessProbe = {
  inspect: (pid: number) => {
    if (process.platform === 'win32') return undefined;
    if (!Number.isInteger(pid) || pid <= 0) return undefined;
    let out: string;
    try {
      out = execFileSync('ps', ['-ww', '-o', 'state=,lstart=', '-p', String(pid)], {
        encoding: 'utf8',
        timeout: 2_000,
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, LC_ALL: 'C' },
      });
    } catch {
      return undefined; // exits non-zero for a pid that no longer exists
    }
    const match = PS_LINE.exec(out);
    if (match === null) return undefined;
    const startedAt = Date.parse(match[2] as string);
    if (Number.isNaN(startedAt)) return undefined;
    return { state: match[1] as string, startedAt };
  },
  resume: (pid: number) => {
    if (process.platform === 'win32') return false;
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 'SIGCONT');
      return true;
    } catch {
      return false;
    }
  },
};

const lockDir = (): string => join(tmpdir(), 'figwright');

/** One note per port, so the `FIGWRIGHT_PORT` test seam can't have two servers share one. */
export const leaderLockPath = (port: number): string => join(lockDir(), `leader-${port}.json`);

/**
 * Record this process as the holder of :port. Best-effort in every direction — a server that cannot
 * write the note still leads, it just cannot be named later. Mode 0600 because on a shared /tmp the
 * note is otherwise plantable, and the only thing it drives is which pid we name and signal.
 */
export const writeLeaderLock = (
  input: {
    port: number;
    buildId: number;
    serverVersion: string;
  },
  probe: ProcessProbe = osProcessProbe,
): void => {
  const lock: LeaderLock = {
    pid: process.pid,
    port: input.port,
    buildId: input.buildId,
    serverVersion: input.serverVersion,
    // The uptime form is only the fallback for a platform with no `ps` — where the reader can't
    // identify anything either, so the value it records is moot.
    processStartedAt:
      probe.inspect(process.pid)?.startedAt ?? Date.now() - Math.round(process.uptime() * 1_000),
  };
  try {
    mkdirSync(lockDir(), { recursive: true });
    writeFileSync(leaderLockPath(input.port), JSON.stringify(lock), { mode: 0o600 });
  } catch {
    /* the note is a diagnostic, never a prerequisite for leading */
  }
};

/**
 * Read the note for :port, or undefined if it's absent, unreadable or malformed.
 *
 * Deliberately never deleted on demotion or shutdown: the next leader overwrites it on bind, and a
 * leftover note is harmless because {@linkcode identifyPortHolder} re-proves the pid anyway.
 * Deleting it would instead open a real race — a leader that abdicates releases the port
 * milliseconds before its own role-change listener runs, so its delete could land _after_ the
 * challenger's write and erase a live leader's note.
 */
export const readLeaderLock = (port: number): LeaderLock | undefined => {
  let raw: string;
  try {
    raw = readFileSync(leaderLockPath(port), 'utf8');
  } catch {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const lock = parsed as Partial<LeaderLock>;
    if (
      !Number.isInteger(lock.pid) ||
      (lock.pid ?? 0) <= 0 ||
      lock.port !== port ||
      typeof lock.serverVersion !== 'string' ||
      typeof lock.processStartedAt !== 'number'
    ) {
      return undefined;
    }
    return {
      pid: lock.pid as number,
      port,
      buildId: typeof lock.buildId === 'number' ? lock.buildId : 0,
      serverVersion: lock.serverVersion,
      processStartedAt: lock.processStartedAt,
    };
  } catch {
    return undefined;
  }
};

/**
 * Who holds :port, if it can be _proved_. Undefined whenever the note is missing, the pid is gone,
 * or its start time doesn't match — all of which mean "we don't know", never "it isn't Figwright".
 */
export const identifyPortHolder = (
  port: number,
  probe: ProcessProbe = osProcessProbe,
): PortHolder | undefined => {
  const lock = readLeaderLock(port);
  if (lock === undefined) return undefined;
  const live = probe.inspect(lock.pid);
  if (live === undefined) return undefined;
  if (Math.abs(live.startedAt - lock.processStartedAt) > PID_IDENTITY_TOLERANCE_MS)
    return undefined;
  return {
    pid: lock.pid,
    buildId: lock.buildId,
    serverVersion: lock.serverVersion,
    // Every state letter is a prefix — 'T', but also macOS's 'T+' for a stopped foreground job.
    stopped: live.state.startsWith('T'),
    resumed: false,
  };
};

/**
 * Resume a holder that is suspended, and report whether the signal went out.
 *
 * This is the one place Figwright acts on another process, so the conditions are exact rather than
 * probable: the pid was re-identified against its recorded start time, and its state is `T`.
 * SIGCONT to a process that is _not_ stopped is a no-op (verified), so the failure mode of a wrong
 * guess here would be nothing happening — but the guard makes even that unreachable. Killing is
 * deliberately not automated: it destroys work, so it stays the user's call and the message names
 * the exact command.
 */
export const resumeStoppedHolder = (
  holder: PortHolder,
  probe: ProcessProbe = osProcessProbe,
): PortHolder => {
  if (!holder.stopped) return holder;
  return { ...holder, resumed: probe.resume(holder.pid) };
};

/**
 * The single user-facing explanation of a port Figwright can't use — shared by `dispatch` (which
 * fails a tool call with it) and `ping` (which reports it), so the two can't drift.
 *
 * The anonymous form no longer claims the holder is "a non-Figwright process": that was an
 * assertion we could not make, and it is exactly wrong for the case this file exists for.
 */
/**
 * How to find what is holding a local port, in the shell the user actually has.
 *
 * This is the whole actionable half of the anonymous message — and on Windows it is the _only_
 * message there is, because nothing there can identify a holder (no `ps`, and no SIGSTOP to be
 * suspended by), so that branch never names a pid. Telling that user to run `lsof` would leave the
 * one path they can reach with an instruction their machine cannot follow.
 */
const findPortHolderHint = (port: number): string =>
  process.platform === 'win32'
    ? `netstat -ano | findstr :${port}`
    : `lsof -iTCP:${port} -sTCP:LISTEN`;

export const portConflictMessage = (port: number, holder?: PortHolder): string => {
  if (holder === undefined) {
    return (
      `port ${port} is held by a process that isn't answering as a Figwright leader, so Figwright ` +
      `can't reach your plugin. Free that port (e.g. ${findPortHolderHint(port)}) and ` +
      `Figwright takes it over automatically.`
    );
  }
  const suspended = holder.stopped
    ? holder.resumed
      ? ' It is suspended (Ctrl-Z or kill -STOP); a SIGCONT was just sent, so if that revived it ' +
        'this clears within seconds.'
      : ' It is suspended (Ctrl-Z or kill -STOP) and could not be resumed automatically.'
    : '';
  return (
    `port ${port} is held by a Figwright server (pid ${holder.pid}, v${holder.serverVersion}) that ` +
    `has stopped answering — it still owns the relay, so no plugin is reachable and no other ` +
    `server can take over.${suspended} If it doesn't recover, kill ${holder.pid} and Figwright ` +
    `takes the port over automatically.`
  );
};
