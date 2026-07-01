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
    if (await this.tryLeadOrFollow()) return;

    // The port is taken but its holder didn't answer a Figwright /ping. It could be a Figwright leader
    // still mid-startup (its /ping endpoint not attached the instant we raced it), so retry once after a
    // short delay. If it's STILL unbindable and STILL not a Figwright leader, a foreign process is
    // squatting the port — do NOT attach as its follower (every forwarded RPC would fail silently).
    // Enter a conflict state that keeps contending and surfaces the clash (see tick / dispatch / ping).
    this.log('[election] port taken but not a Figwright leader — race retry');
    await new Promise<void>(resolve => setTimeout(resolve, RACE_RETRY_DELAY_MS));
    if (await this.tryLeadOrFollow()) return;

    this.node.becomeConflicted();
  }

  /**
   * Settle into a definitive role: bind the port (→ leader), or confirm a Figwright leader already
   * holds it (→ follower). Returns false when the port is taken by something that is NOT a
   * Figwright leader, so the caller decides whether to retry or declare a conflict. Rethrows a
   * non-EADDRINUSE bind error.
   */
  private async tryLeadOrFollow(): Promise<boolean> {
    try {
      await this.node.becomeLeader();
      return true;
    } catch (err) {
      if (!isAddressInUse(err)) {
        this.log(`[election] becomeLeader failed (not EADDRINUSE): ${(err as Error).message}`);
        throw err;
      }
    }

    if (await this.follower.ping()) {
      this.node.becomeFollower();
      return true;
    }

    return false;
  }

  private async tick(): Promise<void> {
    if (this.node.role === NodeRole.Conflicted) {
      // Keep contending: the squatter may release the port, or a real Figwright leader may appear.
      // tryLeadOrFollow promotes us the moment either happens; otherwise we stay conflicted.
      await this.tryLeadOrFollow();
      return;
    }

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
