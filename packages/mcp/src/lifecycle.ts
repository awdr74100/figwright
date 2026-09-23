type Listenable = Pick<NodeJS.EventEmitter, 'on'>;

export const DEFAULT_HARD_EXIT_DELAY_MS = 5_000;

export interface ShutdownWiring {
  /** The process, for SIGINT / SIGTERM. */
  proc: Listenable;
  /** The transport input stream (stdin); its end/close means the client that spawned us is gone. */
  stdin: Listenable;
  /** Performs the actual graceful shutdown; invoked at most once. */
  shutdown: () => void | Promise<void>;
  /**
   * Backstop invoked if the graceful shutdown hasn't exited the process within hardExitDelayMs of
   * the trigger (e.g. process.exit). A graceful path that stalls on an undrainable resource would
   * otherwise leave the process alive forever as a zombie. The timer is unref'd so it never keeps
   * an otherwise-finished process running.
   */
  hardExit?: () => void;
  hardExitDelayMs?: number;
}

/**
 * Wire every "exit now" trigger to a single idempotent shutdown.
 *
 * SIGINT / SIGTERM cover a client that politely signals us. But an MCP server is spawned over stdio
 * by its client, and when that client crashes or is force-closed it may send no signal at all — it
 * just closes the pipe. stdin 'end' / 'close' is the reliable "client is gone" signal, so we treat
 * it as a shutdown trigger too. shutdown runs at most once even if several triggers fire together
 * (e.g. 'end' then 'close').
 *
 * Since @modelcontextprotocol/server 2.1.0 the SDK's stdio transport reacts to stdin EOF too,
 * closing itself so that a server "holding no other keep-alive handles will then exit naturally".
 * That does not stand in for this path: a leader holds the relay port, which is precisely such a
 * handle, so the process would linger as a stale "zombie" leader serving an old build. Closing the
 * relay and exiting is this path's job. The SDK's close reaches the same shutdown anyway, through
 * the transport reporting its own death (see SelfReportingStdioTransport), so the two share the one
 * "at most once" guard rather than tearing down twice.
 *
 * Triggering shutdown is not the same as finishing it: if the graceful path stalls (a close that
 * waits on connections that never drain, a leaked timer pinning the event loop), the process still
 * lingers as a zombie even though shutdown "ran". hardExit is the backstop for that second zombie
 * class — armed when the trigger fires, it force-exits after hardExitDelayMs unless the graceful
 * path exited first.
 *
 * SIGHUP completes the signal side of the same idea. It is the one signal in the "your session is
 * gone" family that no other trigger stands in for on every platform: on Windows it is what a
 * closed console window raises, and SIGTERM does not exist there at all. Leaving it unhandled is
 * not the zombie the paragraph above describes — the POSIX default for SIGHUP already terminates
 * the process promptly, port and all — but it terminates it _instead of_ this shutdown, so the
 * relay is severed rather than closed and the exit is reported as a signal death rather than an
 * ordinary one. Installing a listener removes that default and puts the exit back under the same
 * single path, where hardExit is the thing that guarantees it still ends.
 *
 * Returns the trigger itself, because stdin EOF is not the only way to lose the client. A transport
 * that dies on its own — the SDK closes it when a read fails fatally — detaches from stdin without
 * ending it, so none of the triggers above ever fire. The caller wires that in through the returned
 * function so it shares this one "at most once" guard with the rest.
 */
export const wireShutdown = ({
  proc,
  stdin,
  shutdown,
  hardExit,
  hardExitDelayMs,
}: ShutdownWiring): (() => void) => {
  let triggered = false;
  const once = (): void => {
    if (triggered) return;
    triggered = true;
    if (hardExit !== undefined) {
      const timer = setTimeout(hardExit, hardExitDelayMs ?? DEFAULT_HARD_EXIT_DELAY_MS);
      timer.unref();
    }
    void shutdown();
  };
  proc.on('SIGINT', once);
  proc.on('SIGTERM', once);
  proc.on('SIGHUP', once);
  stdin.on('end', once);
  stdin.on('close', once);
  return once;
};
