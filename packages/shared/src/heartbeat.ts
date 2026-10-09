declare const setInterval: (cb: () => void, ms: number) => unknown;
declare const clearInterval: (handle: unknown) => void;

export const HEARTBEAT_INTERVAL_MS = 15_000;
export const HEARTBEAT_MAX_MISSES = 2;

export interface HeartbeatOptions {
  intervalMs?: number;
  maxMisses?: number;
  sendPing: () => void;
  onTimeout: () => void;
  now?: () => number;
}

export class HeartbeatMonitor {
  private readonly intervalMs: number;
  private readonly maxMisses: number;
  private readonly sendPing: () => void;
  private readonly onTimeout: () => void;
  private readonly now: () => number;
  private timer: unknown = null;
  private lastReceivedAt = 0;
  private lastTickAt = 0;

  constructor(opts: HeartbeatOptions) {
    this.intervalMs = opts.intervalMs ?? HEARTBEAT_INTERVAL_MS;
    this.maxMisses = opts.maxMisses ?? HEARTBEAT_MAX_MISSES;
    this.sendPing = opts.sendPing;
    this.onTimeout = opts.onTimeout;
    this.now = opts.now ?? (() => Date.now());
  }

  start(): void {
    this.lastReceivedAt = this.now();
    this.lastTickAt = this.lastReceivedAt;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  notifyReceived(): void {
    this.lastReceivedAt = this.now();
  }

  private tick(): void {
    const now = this.now();
    // A suspended renderer / sleeping computer could not send or receive heartbeats.
    // Probe on resume and allow a response window, rather than treating the local
    // timer's absence as proof that the remote peer died.
    if (now - this.lastTickAt >= this.intervalMs * 2) {
      this.lastReceivedAt = Math.max(this.lastReceivedAt, now - this.intervalMs);
    }
    this.lastTickAt = now;
    const elapsed = now - this.lastReceivedAt;
    const missesElapsed = Math.floor(elapsed / this.intervalMs);
    if (missesElapsed >= this.maxMisses) {
      this.stop();
      this.onTimeout();
      return;
    }
    // Probe once the peer has been quiet for half an interval, not a whole one. Probing only at a
    // full interval let a healthy peer time out: it answers in a few ms, so the next tick — fired a
    // millisecond or two late, as real timers are — finds the silence just *under* one interval and
    // sends nothing, and the tick after finds it past two and gives up, though the peer was never
    // asked. Measured live: the relay's ticks drifted ~1.5ms each against ~3ms replies, and
    // 29,997 + 2 × 1.5 crossed 30,000. Probing at half guarantees the tick before a timeout sent a
    // probe, so the peer always had a full interval to answer one.
    if (elapsed > this.intervalMs / 2) {
      this.sendPing();
    }
  }
}
