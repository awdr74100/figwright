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
// Handing the thread back cannot rely on a timer. In a background Figma tab a zero-delay timer can
// wait close to a minute before it fires, while the same sandbox still answers messages within
// milliseconds. Measured with every slice yielding on a timer: a 3,591-instance scan that took 3.2s
// in front took 52–76s once its file had sat in a background tab for two minutes. So the sandbox
// yields through a message round-trip with the panel instead, which no timer gates — the same scan
// took 2.8–2.9s in a background tab, 3.0–3.3s minimized and 2.7–2.9s with the panel hidden.
//
// The panel also reports whether its document is hidden. A hidden file, or a round-trip slower than
// THROTTLED_YIELD_MS (a panel busy with other work), gets coarser slices for a while: fewer
// handoffs where nobody is watching the editor repaint, or where each handoff is expensive. Slices
// are coarsened rather than stopped, so the host keeps getting turns and other tool calls and the
// panel's own traffic still flow during a long read.

import { createHostYield, parseHostYield } from '../protocol/host-yield.js';

/** How long one slice may hold the thread before handing it back. */
export const SLICE_MS = 40;

/** A yield slower than this means the host is throttling our handoffs, not just busy. */
const THROTTLED_YIELD_MS = 250;

/** A background / slow host gets fewer handoffs, but never a whole unsliced heavy read. */
const BACKOFF_SLICE_MS = 250;

/** After a throttled yield, how long to use coarser slices before probing normal pacing again. */
const THROTTLED_BACKOFF_MS = 30_000;

let throttledUntil = 0;
let wasBackground = false;
let nextYieldId = 0;
const pendingYields = new Map<number, (background: boolean) => void>();

/**
 * A message round-trip is a host turn; a resolved promise would only drain microtasks. Outside the
 * Figma runtime (standalone consumers / tests), a timer supplies that same boundary.
 */
const yieldToHost = (): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    if (typeof figma === 'undefined') {
      setTimeout(resolve, 0);
      return;
    }
    const id = ++nextYieldId;
    pendingYields.set(id, background => {
      if (background) throttledUntil = Date.now() + THROTTLED_BACKOFF_MS;
      else if (wasBackground) throttledUntil = 0;
      wasBackground = background;
      resolve();
    });
    try {
      // eslint-disable-next-line unicorn/require-post-message-target-origin
      figma.ui.postMessage(createHostYield(id, 'yield-request'));
    } catch (error) {
      pendingYields.delete(id);
      reject(error);
    }
  });

/** Consume only panel resumes, leaving tool and panel-control traffic to their own dispatchers. */
export const resumeHostYield = (raw: unknown): boolean => {
  const message = parseHostYield(raw);
  if (message?.kind !== 'yield-resume') return false;
  const resume = pendingYields.get(message.id);
  pendingYields.delete(message.id);
  resume?.(message.background);
  return true;
};

/** Tracks how long the current slice has run; `due()` says it is time to yield. */
export class TimeSlice {
  private start = Date.now();

  due(): boolean {
    const now = Date.now();
    const length = now < throttledUntil ? BACKOFF_SLICE_MS : SLICE_MS;
    return now - this.start >= length;
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
  wasBackground = false;
};
