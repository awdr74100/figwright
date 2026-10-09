import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetThrottleForTests, SLICE_MS, TimeSlice } from '../src/cooperative.js';

describe('TimeSlice', () => {
  let now = 0;

  beforeEach(() => {
    resetThrottleForTests();
    now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is due once a slice has run its length, and starts a new one after yielding', async () => {
    const slice = new TimeSlice();
    now = SLICE_MS - 1;
    expect(slice.due()).toBe(false);
    now = SLICE_MS;
    expect(slice.due()).toBe(true);
    await slice.yield();
    expect(slice.due()).toBe(false);
  });

  it('stops yielding for a while after the host is slow to hand the thread back', async () => {
    const slice = new TimeSlice();
    now = SLICE_MS;
    // A hidden page's timer wakes up to a second late: what throttling looks like from inside.
    const yielding = slice.yield();
    now += 1_000;
    await yielding;

    now += SLICE_MS;
    expect(slice.due()).toBe(false);
    // A later run on the same throttled host does not pay for it again.
    const next = new TimeSlice();
    now += SLICE_MS;
    expect(next.due()).toBe(false);

    // Long enough later, it probes again.
    now += 30_000;
    expect(next.due()).toBe(true);
  });

  it('keeps yielding while the host answers promptly', async () => {
    const slice = new TimeSlice();
    now = SLICE_MS;
    const yielding = slice.yield();
    now += 5;
    await yielding;
    now += SLICE_MS;
    expect(slice.due()).toBe(true);
  });
});
