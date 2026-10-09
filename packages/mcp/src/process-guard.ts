import { Console } from 'node:console';

// The last line of defense for the MCP connection. This server is one process speaking one stdio
// connection to its client, and it often leads the relay every other agent's session goes through.
// Node's default for an error nothing caught — an `uncaughtException` or an `unhandledRejection` —
// is to end the process, which drops that connection (every later call fails until the user
// reconnects by hand) and, on the leader, every plugin and follower with it.
//
// So nothing is allowed to end it that way: the error is reported on stderr and the process keeps
// serving. Node's own guidance is to exit after an uncaught exception, because the program may be
// left in a state nobody planned for; here that trade runs the other way. The server's state is
// per request and per socket — a request that failed half-way has already failed, its timer still
// reaps it — and the election re-converges on its own ticks, so continuing costs at most the one
// operation that threw, while exiting costs every session at once. The specific paths known to
// throw are fixed where they are; this is for the ones nobody has found yet.
//
// stdout is the protocol channel. A stray `console.log` — ours or a dependency's — would put a line
// on it that is not JSON-RPC, and the client would drop the connection over it. The console is
// pointed at stderr for that reason.

/** After this many reports, further ones are counted but not written. */
const MAX_REPORTS = 50;

const describe = (error: unknown): string =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);

interface ProcessLike {
  on(event: 'uncaughtException', listener: (error: Error) => void): unknown;
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
}

interface StreamLike {
  on(event: 'error', listener: (error: Error) => void): unknown;
}

/**
 * Keep the process alive through errors nothing caught, reporting each through `write`.
 *
 * A report that itself fails is dropped rather than retried: the likeliest reason is that stderr is
 * gone too, and raising from here would come straight back as another uncaught error.
 */
export const guardProcess = (proc: ProcessLike, write: (text: string) => void): void => {
  let reports = 0;
  let reporting = false;
  const report = (kind: string, error: unknown): void => {
    // Re-entry means the write below raised synchronously and that came back here.
    if (reporting) return;
    reports += 1;
    if (reports > MAX_REPORTS) return;
    reporting = true;
    try {
      const tail = reports === MAX_REPORTS ? ' (further reports suppressed)' : '';
      write(`[figwright] ${kind} — kept running${tail}: ${describe(error)}\n`);
    } catch {
      // stderr is not writable; there is nowhere left to report to.
    } finally {
      reporting = false;
    }
  };
  proc.on('uncaughtException', error => report('uncaught exception', error));
  proc.on('unhandledRejection', reason => report('unhandled rejection', reason));
};

/**
 * Swallow write errors on the stdio streams. A stream with no 'error' listener turns a failed write
 * (EPIPE once the client is gone) into an uncaught exception, and a failed report on stderr would
 * then raise another one — a loop. The client going away is handled by stdin's end (lifecycle.ts).
 */
export const muteStreamErrors = (...streams: StreamLike[]): void => {
  for (const stream of streams) stream.on('error', () => undefined);
};

/** Point every console method at stderr, so nothing a console call writes can reach stdout. */
export const consoleToStderr = (target: Console, stderr: NodeJS.WritableStream): void => {
  Object.assign(target, new Console({ stdout: stderr, stderr }));
};
