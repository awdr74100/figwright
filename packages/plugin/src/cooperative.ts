// The sandbox runs on Figma's main thread: while a handler computes, the editor cannot repaint and
// no other message — another tool call, the UI's reply channel — is delivered. A long read therefore
// hands the thread back between slices of work, or Figma freezes for its whole duration (measured: a
// 32k-instance type scan held the thread for ~23s, and a ping sent meanwhile waited the entire time;
// slicing brought that ping's median wait down to ~0.3s).
//
// Slices are measured in time, not node counts, because what a node costs varies by an order of
// magnitude from file to file (~0.7ms per instance on a light page, ~4.4ms on a heavy library page):
// a fixed batch that is responsive on one blocks for seconds on the other.
//
// Handing the thread back takes a timer, and a hidden page's timers are throttled (Chromium wakes
// them at most once a second, and a chain of timers on a page hidden for five minutes at most once a
// minute). Measured with Figma minimized, reads that yielded on a timer after every fixed batch went
// from ~3s to past the 120s budget — a 4,096-instance scan, a 2,048-instance get_node — while the
// main branch, which never yields, still took ~4s. So a yield that comes back late is read as "the
// host is throttling us" and yielding stops for a while: nobody is watching a hidden editor repaint,
// and the run finishes as fast as an unsliced one (measured minimized: 3.1s for that scan, 3.8s for
// that get_node). The first late yield is the whole cost; a run starts from a message rather than a
// timer, so by Chromium's rules that first one waits at most the one-second wake-up.

/** How long one slice may hold the thread before handing it back. */
export const SLICE_MS = 40;

/** A yield slower than this means the host is throttling timers (a hidden page), not just busy. */
const THROTTLED_YIELD_MS = 250;

/** After a throttled yield, how long to stop yielding before probing again. */
const THROTTLED_BACKOFF_MS = 30_000;

let throttledUntil = 0;

/**
 * Let Figma run its own queue. Awaiting a resolved promise only drains microtasks — the host's
 * message / timer / render loop never gets a turn — so it has to be a timer.
 */
const yieldToHost = (): Promise<void> =>
  new Promise<void>(resolve => {
    setTimeout(resolve, 0);
  });

/** Tracks how long the current slice has run; `due()` says it is time to yield. */
export class TimeSlice {
  private start = Date.now();

  due(): boolean {
    const now = Date.now();
    return now >= throttledUntil && now - this.start >= SLICE_MS;
  }

  async yield(): Promise<void> {
    const before = Date.now();
    await yieldToHost();
    const after = Date.now();
    if (after - before >= THROTTLED_YIELD_MS) throttledUntil = after + THROTTLED_BACKOFF_MS;
    this.start = after;
  }
}

/** Test seam: forget a throttled yield seen by an earlier run. */
export const resetThrottleForTests = (): void => {
  throttledUntil = 0;
};
