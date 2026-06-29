type Listenable = Pick<NodeJS.EventEmitter, 'on'>;

export interface ShutdownWiring {
  /** The process, for SIGINT / SIGTERM. */
  proc: Listenable;
  /** The transport input stream (stdin); its end/close means the client that spawned us is gone. */
  stdin: Listenable;
  /** Performs the actual graceful shutdown; invoked at most once. */
  shutdown: () => void | Promise<void>;
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
 */
export const wireShutdown = ({ proc, stdin, shutdown }: ShutdownWiring): void => {
  let triggered = false;
  const once = (): void => {
    if (triggered) return;
    triggered = true;
    void shutdown();
  };
  proc.on('SIGINT', once);
  proc.on('SIGTERM', once);
  stdin.on('end', once);
  stdin.on('close', once);
};
