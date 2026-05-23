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

  constructor(opts: HeartbeatOptions) {
    this.intervalMs = opts.intervalMs ?? HEARTBEAT_INTERVAL_MS;
    this.maxMisses = opts.maxMisses ?? HEARTBEAT_MAX_MISSES;
    this.sendPing = opts.sendPing;
    this.onTimeout = opts.onTimeout;
    this.now = opts.now ?? (() => Date.now());
  }

  start(): void {
    this.lastReceivedAt = this.now();
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
    const elapsed = this.now() - this.lastReceivedAt;
    const missesElapsed = Math.floor(elapsed / this.intervalMs);
    if (missesElapsed >= this.maxMisses) {
      this.stop();
      this.onTimeout();
      return;
    }
    if (missesElapsed >= 1) {
      this.sendPing();
    }
  }
}
