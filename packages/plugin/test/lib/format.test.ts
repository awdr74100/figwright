import { describe, expect, it } from 'vitest';

import { formatClockTime, formatRelativeTime, formatSize } from '../../ui/lib/format.js';

describe('formatSize', () => {
  it('reports raw bytes below one kilobyte', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(1)).toBe('1 B');
    expect(formatSize(1023)).toBe('1023 B');
  });

  it('switches to kilobytes at the 1024 boundary', () => {
    expect(formatSize(1024)).toBe('1.0 KB');
    expect(formatSize(1536)).toBe('1.5 KB');
  });

  it('keeps one decimal place for larger payloads', () => {
    expect(formatSize(10 * 1024)).toBe('10.0 KB');
    expect(formatSize(1024 * 1024)).toBe('1024.0 KB');
  });
});

describe('formatClockTime', () => {
  // Built from local components so the expectation holds in any timezone the suite runs in.
  const at = (h: number, m: number, s: number): number => new Date(2026, 6, 25, h, m, s).getTime();

  it('renders wall-clock time as HH:MM:SS', () => {
    expect(formatClockTime(at(14, 22, 1))).toBe('14:22:01');
  });

  it('zero-pads every field', () => {
    expect(formatClockTime(at(9, 5, 3))).toBe('09:05:03');
  });

  it('uses a 24-hour clock', () => {
    expect(formatClockTime(at(0, 0, 0))).toBe('00:00:00');
    expect(formatClockTime(at(23, 59, 59))).toBe('23:59:59');
  });
});

describe('formatRelativeTime', () => {
  const NOW = 1_700_000_000_000;

  it('reads "now" for anything under half a second old', () => {
    expect(formatRelativeTime(NOW, NOW)).toBe('now');
    expect(formatRelativeTime(NOW - 400, NOW)).toBe('now');
  });

  it('counts seconds up to the minute boundary', () => {
    expect(formatRelativeTime(NOW - 1_000, NOW)).toBe('1s');
    expect(formatRelativeTime(NOW - 59_000, NOW)).toBe('59s');
  });

  it('rolls over to minutes at 60 seconds', () => {
    expect(formatRelativeTime(NOW - 60_000, NOW)).toBe('1m');
    expect(formatRelativeTime(NOW - 90_000, NOW)).toBe('1m');
    expect(formatRelativeTime(NOW - 59 * 60_000, NOW)).toBe('59m');
  });

  it('rolls over to hours at 60 minutes', () => {
    expect(formatRelativeTime(NOW - 60 * 60_000, NOW)).toBe('1h');
    expect(formatRelativeTime(NOW - 25 * 60 * 60_000, NOW)).toBe('25h');
  });

  // The panel renders timestamps from the relay, whose clock can be marginally ahead of the
  // iframe's. Without the clamp that would show a negative age.
  it('clamps future timestamps to "now" instead of going negative', () => {
    expect(formatRelativeTime(NOW + 5_000, NOW)).toBe('now');
  });
});
