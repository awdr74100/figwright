import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HeartbeatMonitor } from '../src/heartbeat.js';

const makeMonitor = (intervalMs = 1_000, maxMisses = 2) => {
  const sendPing = vi.fn<() => void>();
  const onTimeout = vi.fn<() => void>();
  const hb = new HeartbeatMonitor({ intervalMs, maxMisses, sendPing, onTimeout });
  return { hb, sendPing, onTimeout };
};

describe('HeartbeatMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends ping after one interval of silence', () => {
    const { hb, sendPing, onTimeout } = makeMonitor();
    hb.start();
    vi.advanceTimersByTime(1_000);
    expect(sendPing).toHaveBeenCalledTimes(1);
    expect(onTimeout).not.toHaveBeenCalled();
    hb.stop();
  });

  it('does not send ping while activity is fresh', () => {
    const { hb, sendPing } = makeMonitor();
    hb.start();
    vi.advanceTimersByTime(700);
    hb.notifyReceived();
    vi.advanceTimersByTime(300);
    expect(sendPing).not.toHaveBeenCalled();
    hb.stop();
  });

  it('keeps a peer that answers promptly while the timer drifts late', () => {
    // Real interval timers fire a little late each time. Driven off an explicit clock: every tick
    // lands 2ms later than the last, and the peer answers each probe within 3ms.
    let clock = 0;
    const sendPing = vi.fn<() => void>();
    const onTimeout = vi.fn<() => void>();
    const hb = new HeartbeatMonitor({
      intervalMs: 1_000,
      maxMisses: 2,
      sendPing,
      onTimeout,
      now: () => clock,
    });
    hb.start();
    for (let tick = 1; tick <= 20; tick += 1) {
      clock = tick * 1_002;
      const probes = sendPing.mock.calls.length;
      vi.advanceTimersByTime(1_000);
      if (sendPing.mock.calls.length > probes) {
        clock += 3;
        hb.notifyReceived();
      }
    }
    expect(onTimeout).not.toHaveBeenCalled();
    hb.stop();
  });

  it('fires onTimeout after maxMisses intervals without activity', () => {
    const { hb, sendPing, onTimeout } = makeMonitor();
    hb.start();
    vi.advanceTimersByTime(1_000);
    expect(sendPing).toHaveBeenCalledTimes(1);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(sendPing).toHaveBeenCalledTimes(1);
  });

  it('stop() prevents further ticks', () => {
    const { hb, sendPing, onTimeout } = makeMonitor();
    hb.start();
    hb.stop();
    vi.advanceTimersByTime(5_000);
    expect(sendPing).not.toHaveBeenCalled();
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('receive resets miss accumulation and prevents premature timeout', () => {
    const { hb, sendPing, onTimeout } = makeMonitor();
    hb.start();
    vi.advanceTimersByTime(1_000);
    expect(sendPing).toHaveBeenCalledTimes(1);
    hb.notifyReceived();
    vi.advanceTimersByTime(1_000);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(sendPing).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1_000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('probes before timing out after the local timer was suspended', () => {
    const { hb, sendPing, onTimeout } = makeMonitor();
    hb.start();
    // A background renderer / sleeping computer resumes with a large wall-clock jump,
    // but no interval callbacks ran while it was suspended.
    vi.setSystemTime(Date.now() + 60_000);
    vi.advanceTimersByTime(1_000);
    expect(sendPing).toHaveBeenCalledTimes(1);
    expect(onTimeout).not.toHaveBeenCalled();
    hb.notifyReceived();
    vi.advanceTimersByTime(1_000);
    expect(onTimeout).not.toHaveBeenCalled();
    hb.stop();
  });

  it('still times out an unresponsive peer after a suspended timer resumes', () => {
    const { hb, sendPing, onTimeout } = makeMonitor();
    hb.start();
    vi.advanceTimersByTime(1_000);
    vi.setSystemTime(Date.now() + 60_000);
    vi.advanceTimersByTime(1_000);
    expect(sendPing).toHaveBeenCalledTimes(2);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });
});
