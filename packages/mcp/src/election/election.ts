import type { Follower } from './follower.js';
import {
  identifyPortHolder,
  osProcessProbe,
  type ProcessProbe,
  resumeStoppedHolder,
} from './leader-lock.js';
import { isAddressInUse, type Node, NodeRole } from './node.js';

export const DEFAULT_TICK_INTERVAL_MS = 1_000;
const RACE_RETRY_DELAY_MS = 50;

/**
 * After abdicating, how long this node sits out dead-leader takeovers. The challenger grabs the
 * port within milliseconds of the release, but until it does, our own tick would see "leader
 * unresponsive" and re-bind — undoing the handoff we just granted. If the challenger dies before
 * binding, this expires and normal takeover resumes (brief outage, then self-heal).
 */
export const YIELD_GRACE_MS = 5_000;

/**
 * After a 'refused' or 'unsupported' abdication answer, how long to stop asking. Neither outcome
 * changes on the next 1s tick (an old leader won't grow the endpoint), so re-asking every tick is
 * pure log noise; a full minute later is soon enough to notice a replaced leader.
 */
export const ABDICATION_BACKOFF_MS = 60_000;

/** How eagerly the challenger grabs the port a leader just released for it (~ms handoff). */
const ABDICATION_GRAB_ATTEMPTS = 20;
const ABDICATION_GRAB_DELAY_MS = 50;

/**
 * Consecutive ticks that must find the leader silent _and_ the port still bound before this node
 * declares the deadlock (see leader-lock.ts) instead of retrying into it forever.
 *
 * Every ordinary way a leader ends releases the port, so those ticks find it free and take over on
 * the first one — this threshold is only ever reached by a leader that is alive, holding the port
 * and not answering. The number is a floor on how long a _transient_ stall may last without being
 * mistaken for that: each such tick costs the 2s ping timeout plus the tick interval, so five of
 * them is roughly twelve seconds of continuous silence. Well above anything measured (a 6000-file
 * `scan_components` on the leader kept `/ping` under 30ms), and far below the tool budget the
 * follower would otherwise spend hanging (40s for a default tool, 130s × 3 attempts for a heavy
 * one).
 */
export const WEDGED_UNRESPONSIVE_TICKS = 5;

export interface ElectionOptions {
  node: Node;
  follower: Follower;
  /**
   * This process's build stamp (see build-id.ts); drives newest-build-wins. Default 0 (never
   * challenges).
   */
  buildId?: number;
  tickIntervalMs?: number;
  log?: (msg: string) => void;
  /** OS probe used to identify (and resume) a wedged port holder; injected by tests. */
  probe?: ProcessProbe;
}

export class Election {
  private readonly node: Node;
  private readonly follower: Follower;
  private readonly buildId: number;
  private readonly tickIntervalMs: number;
  private readonly log: (msg: string) => void;
  private readonly probe: ProcessProbe;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private tickInFlight = false;
  private yieldUntil = 0;
  private abdicationBackoffUntil = 0;
  /** Consecutive ticks that found the leader silent while the port stayed bound. */
  private unresponsiveTicks = 0;

  constructor(opts: ElectionOptions) {
    this.node = opts.node;
    this.follower = opts.follower;
    this.buildId = opts.buildId ?? 0;
    this.tickIntervalMs = opts.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
    this.log = opts.log ?? ((): void => {});
    this.probe = opts.probe ?? osProcessProbe;
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

    // Reached by a foreign squatter and by a wedged Figwright leader alike — a process starting up
    // behind one cannot tell them apart from the outside, so it asks the same question the tick
    // asks: is there a leader note for this port whose process is still the one that wrote it?
    this.enterConflicted();
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

  /**
   * Release leadership because a newer build asked for it (wired to the /abdicate endpoint).
   * Demotes to follower and opens the yield window so this node's own tick doesn't immediately
   * re-take the port it just released. Safe to call in any state (no-op unless leading).
   */
  yieldLeadership(): void {
    if (!this.node.isLeader()) return;
    this.yieldUntil = Date.now() + YIELD_GRACE_MS;
    this.node.becomeFollower();
    this.log('[election] abdicated — a newer build is taking over');
  }

  private async tick(): Promise<void> {
    // A tick can outlive the interval (leaderInfo's ping timeout is 2s, the post-abdication grab
    // loop ~1s, vs 1s ticks). Every stacked interleaving is idempotent and converges, but skipping
    // is strictly simpler to reason about than proving that: one tick in flight at a time, and a
    // tick is bounded (~3s worst case), so the next one is never starved.
    if (this.tickInFlight) return;
    this.tickInFlight = true;
    try {
      await this.tickBody();
    } finally {
      this.tickInFlight = false;
    }
  }

  private async tickBody(): Promise<void> {
    if (this.node.role === NodeRole.Conflicted) {
      // Keep contending: the squatter may release the port, or a real Figwright leader may appear.
      // tryLeadOrFollow promotes us the moment either happens; otherwise we stay conflicted.
      await this.tryLeadOrFollow();
      return;
    }

    if (this.node.role !== NodeRole.Follower) return;

    const leader = await this.follower.leaderInfo();
    if (leader !== undefined) {
      this.unresponsiveTicks = 0;
      // Healthy leader — but if it runs a strictly older build than us, it's serving stale code
      // (the "zombie leader" a rebuild leaves behind when an old process still owns the port).
      // Newest build wins: ask it to step down and take over. Same single /ping round-trip as the
      // old health check.
      if (this.buildId > (leader.buildId ?? 0) && Date.now() >= this.abdicationBackoffUntil) {
        await this.challengeStaleLeader();
      }
      return;
    }

    // We just granted an abdication: the challenger is grabbing the port, so a failed ping in this
    // window is the handoff, not a dead leader. Don't undo it by re-binding.
    if (Date.now() < this.yieldUntil) return;

    this.log('[election] leader unresponsive — attempting takeover');
    try {
      await this.node.becomeLeader();
      this.unresponsiveTicks = 0;
    } catch (err) {
      if (isAddressInUse(err)) {
        // Silent leader, port still bound. Once is the ordinary handoff race (another node beat us
        // to it, and its /ping will answer on the next tick). Repeated, it is the one failure the
        // election cannot resolve by waiting: see WEDGED_UNRESPONSIVE_TICKS and leader-lock.ts.
        this.unresponsiveTicks += 1;
        this.log(
          `[election] takeover lost — port still held by an unresponsive owner ` +
            `(${this.unresponsiveTicks}/${WEDGED_UNRESPONSIVE_TICKS})`,
        );
        if (this.unresponsiveTicks >= WEDGED_UNRESPONSIVE_TICKS) this.enterConflicted();
      } else {
        this.log(`[election] takeover failed: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Declare the port unusable, having first tried to find out who holds it — and, if that process
   * turns out to be suspended, to wake it.
   *
   * The conflict state is self-healing: its tick keeps calling tryLeadOrFollow, so a holder that
   * frees the port (or starts answering again, which is what SIGCONT is for) puts this node back to
   * leader or follower within one tick. What it buys in the meantime is that `dispatch` fails a
   * tool call in milliseconds with a message naming the process to kill, instead of hanging for the
   * tool's full budget and reporting a bare timeout.
   */
  private enterConflicted(): void {
    this.unresponsiveTicks = 0;
    const identified = identifyPortHolder(this.node.port, this.probe);
    const holder =
      identified === undefined ? undefined : resumeStoppedHolder(identified, this.probe);
    if (holder?.resumed === true) {
      this.log(`[election] port holder pid ${holder.pid} is suspended — sent SIGCONT`);
    }
    this.node.becomeConflicted(holder);
  }

  /**
   * The leader runs a strictly older build: ask it to abdicate, and on acceptance grab the port it
   * releases. Losing the grab race is fine — whoever won is either newer than us (we're done) or
   * older (we challenge again on a later tick); the lattice converges on the newest build.
   */
  private async challengeStaleLeader(): Promise<void> {
    const outcome = await this.follower.requestAbdication(this.buildId);
    if (outcome === 'busy' || outcome === 'error') return; // retry naturally on a later tick
    if (outcome === 'refused' || outcome === 'unsupported') {
      this.abdicationBackoffUntil = Date.now() + ABDICATION_BACKOFF_MS;
      this.log(
        outcome === 'unsupported'
          ? '[election] stale leader predates abdication — it must be retired manually (see ping)'
          : '[election] abdication refused — leader no longer older; backing off',
      );
      return;
    }

    this.log('[election] stale leader is abdicating — grabbing the port');
    /* eslint-disable no-await-in-loop -- deliberate short retry loop over the handoff window */
    for (let attempt = 0; attempt < ABDICATION_GRAB_ATTEMPTS; attempt += 1) {
      try {
        await this.node.becomeLeader();
        return;
      } catch (err) {
        if (!isAddressInUse(err)) {
          this.log(`[election] post-abdication takeover failed: ${(err as Error).message}`);
          return;
        }
      }
      await new Promise<void>(resolve => setTimeout(resolve, ABDICATION_GRAB_DELAY_MS));
    }
    /* eslint-enable no-await-in-loop */
    this.log('[election] post-abdication grab lost — another node took the port');
  }
}
