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
    vi.advanceTimersByTime(500);
    hb.notifyReceived();
    vi.advanceTimersByTime(500);
    expect(sendPing).not.toHaveBeenCalled();
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
});
