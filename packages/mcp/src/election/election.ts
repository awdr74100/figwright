import type { Follower } from './follower.js';
import { isAddressInUse, type Node, NodeRole } from './node.js';

export const DEFAULT_TICK_INTERVAL_MS = 1_000;
const RACE_RETRY_DELAY_MS = 50;

export interface ElectionOptions {
  node: Node;
  follower: Follower;
  tickIntervalMs?: number;
  log?: (msg: string) => void;
}

export class Election {
  private readonly node: Node;
  private readonly follower: Follower;
  private readonly tickIntervalMs: number;
  private readonly log: (msg: string) => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(opts: ElectionOptions) {
    this.node = opts.node;
    this.follower = opts.follower;
    this.tickIntervalMs = opts.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
    this.log = opts.log ?? ((): void => {});
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.determineRole();
    this.timer = setInterval(() => {
      if (!this.running) return;
      void this.tick();
    }, this.tickIntervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tickOnce(): Promise<void> {
    await this.tick();
  }

  async determineRole(): Promise<void> {
    try {
      await this.node.becomeLeader();
      return;
    } catch (err) {
      if (!isAddressInUse(err)) {
        this.log(`[election] becomeLeader failed (not EADDRINUSE): ${(err as Error).message}`);
        throw err;
      }
    }

    if (await this.follower.ping()) {
      this.node.becomeFollower();
      return;
    }

    this.log('[election] port taken but leader unresponsive — race retry');
    await new Promise<void>(resolve => setTimeout(resolve, RACE_RETRY_DELAY_MS));
    try {
      await this.node.becomeLeader();
    } catch {
      this.node.becomeFollower();
    }
  }

  private async tick(): Promise<void> {
    if (this.node.role !== NodeRole.Follower) return;

    if (await this.follower.ping()) return;

    this.log('[election] leader unresponsive — attempting takeover');
    try {
      await this.node.becomeLeader();
    } catch (err) {
      if (isAddressInUse(err)) {
        this.log('[election] takeover lost — another node took the port');
      } else {
        this.log(`[election] takeover failed: ${(err as Error).message}`);
      }
    }
  }
}
