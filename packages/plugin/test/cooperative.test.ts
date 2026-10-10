import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HostYieldMessage } from '../protocol/host-yield.js';
import { resetThrottleForTests, resumeHostYield, SLICE_MS, TimeSlice } from '../src/cooperative.js';

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

  it('coarsens slices for a while after the host is slow to hand the thread back', async () => {
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

  it('hands a sandbox yield to the panel without depending on a background timer', async () => {
    const postMessage = vi.fn<(message: HostYieldMessage) => void>();
    vi.stubGlobal('figma', { ui: { postMessage } });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const slice = new TimeSlice();
      now = SLICE_MS;
      const yielding = slice.yield();

      // Timers deliberately never run: hidden Figma files can strand a read here even while
      // tool messages still arrive. A panel round-trip must be the host-turn boundary instead.
      expect(postMessage).toHaveBeenCalledWith({
        tag: '@figwright/yield',
        kind: 'yield-request',
        id: expect.any(Number),
      });
      expect(vi.getTimerCount()).toBe(0);
      const message = postMessage.mock.calls[0]![0];
      expect(resumeHostYield({ ...message, kind: 'yield-resume', background: false })).toBe(true);
      await yielding;
      now += SLICE_MS;
      expect(slice.due()).toBe(true);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('resumes overlapping yields by id and ignores unrelated, stale or malformed replies', async () => {
    const postMessage = vi.fn<(message: HostYieldMessage) => void>();
    vi.stubGlobal('figma', { ui: { postMessage } });
    try {
      const settled: number[] = [];
      const first = new TimeSlice().yield().then(() => settled.push(1));
      const second = new TimeSlice().yield().then(() => settled.push(2));
      const a = postMessage.mock.calls[0]![0];
      const b = postMessage.mock.calls[1]![0];
      expect(a.id).not.toBe(b.id);
      expect(resumeHostYield(a)).toBe(false);
      expect(resumeHostYield(null)).toBe(false);
      expect(resumeHostYield({ ...a, id: '1', kind: 'yield-resume' })).toBe(false);
      expect(resumeHostYield({ ...a, tag: '@figwright/bridge', kind: 'yield-resume' })).toBe(false);
      expect(resumeHostYield({ ...b, id: b.id + 1, kind: 'yield-resume', background: true })).toBe(
        true,
      );
      await Promise.resolve();
      expect(settled).toEqual([]);

      resumeHostYield({ ...b, kind: 'yield-resume', background: false });
      await second;
      expect(settled).toEqual([2]);
      resumeHostYield({ ...b, kind: 'yield-resume', background: false });
      resumeHostYield({ ...a, kind: 'yield-resume', background: false });
      await first;
      expect(settled).toEqual([2, 1]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses the existing backoff when a matching panel reply reports a hidden file', async () => {
    const postMessage = vi.fn<(message: HostYieldMessage) => void>();
    vi.stubGlobal('figma', { ui: { postMessage } });
    try {
      const slice = new TimeSlice();
      now = SLICE_MS;
      const yielding = slice.yield();
      const request = postMessage.mock.calls[0]![0];
      resumeHostYield({ ...request, kind: 'yield-resume', background: true });
      await yielding;
      now += SLICE_MS;
      expect(slice.due()).toBe(false);
      const next = new TimeSlice();
      now += SLICE_MS;
      expect(next.due()).toBe(false);
      now += 30_000;
      expect(next.due()).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('bounds uninterrupted work even while a hidden-file backoff is active', async () => {
    const postMessage = vi.fn<(message: HostYieldMessage) => void>();
    vi.stubGlobal('figma', { ui: { postMessage } });
    try {
      const slice = new TimeSlice();
      now = SLICE_MS;
      const yielding = slice.yield();
      const request = postMessage.mock.calls[0]![0];
      resumeHostYield({ ...request, kind: 'yield-resume', background: true });
      await yielding;
      now += SLICE_MS;
      expect(slice.due()).toBe(false);
      now += 250 - SLICE_MS;
      expect(slice.due()).toBe(true);
      const returning = slice.yield();
      const nextRequest = postMessage.mock.calls[1]![0];
      resumeHostYield({ ...nextRequest, kind: 'yield-resume', background: false });
      await returning;
      now += SLICE_MS;
      expect(slice.due()).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('propagates a failed host handoff rather than leaving the read pending', async () => {
    const failure = new Error('panel unavailable');
    vi.stubGlobal('figma', {
      ui: {
        postMessage: () => {
          throw failure;
        },
      },
    });
    try {
      await expect(new TimeSlice().yield()).rejects.toBe(failure);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
