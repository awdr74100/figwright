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
 * just closes the pipe. The SDK's stdio transport reacts only to stdin 'data' / 'error', never to
 * EOF, so without this the process lingers, keeps holding the relay port, and becomes a stale
 * "zombie" leader serving an old build. stdin 'end' / 'close' is the reliable "client is gone"
 * signal, so we treat it as a shutdown trigger too. shutdown runs at most once even if several
 * triggers fire together (e.g. 'end' then 'close').
 *
 * Triggering shutdown is not the same as finishing it: if the graceful path stalls (a close that
 * waits on connections that never drain, a leaked timer pinning the event loop), the process still
 * lingers as a zombie even though shutdown "ran". hardExit is the backstop for that second zombie
 * class — armed when the trigger fires, it force-exits after hardExitDelayMs unless the graceful
 * path exited first.
 */
export const wireShutdown = ({
  proc,
  stdin,
  shutdown,
  hardExit,
  hardExitDelayMs,
}: ShutdownWiring): void => {
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
  stdin.on('end', once);
  stdin.on('close', once);
};
