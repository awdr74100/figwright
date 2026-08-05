import { describe, expect, it } from 'vitest';

import { CANDIDATE_FLOOR, statusFor } from '../../src/join/status.js';

describe('statusFor', () => {
  it('grades against the absolute mark at the default bar', () => {
    expect(statusFor(1, 0.7)).toBe('high');
    expect(statusFor(0.9, 0.7)).toBe('high');
    expect(statusFor(0.8, 0.7)).toBe('medium');
    expect(statusFor(0.6, 0.7)).toBe('low');
    expect(statusFor(0.4, 0.7)).toBe('unmapped');
  });

  it('lets a raised bar demote a match the absolute mark would call high', () => {
    // The bug this encodes: `high`/`medium` mean "reuse this component" to codegen, so threshold is
    // the reuse bar. A hardcoded top cut ignored a caller asking for something stricter than 0.85 —
    // exactly the caller who has already been burned by a wrong reuse.
    expect(statusFor(0.889, 0.7)).toBe('high');
    expect(statusFor(0.889, 0.9)).toBe('low'); // below the caller's bar → not reuse-grade
    expect(statusFor(0.95, 0.9)).toBe('high'); // clears both → still reuse-grade
    expect(statusFor(1, 1)).toBe('high'); // a bar of 1 still admits a perfect match
  });

  it('is monotonic: raising the bar never promotes a mapping', () => {
    const rank = { unmapped: 0, low: 1, medium: 2, high: 3, 'framework-builtin': 0 } as const;
    for (let c = 0; c <= 1.0001; c += 0.05) {
      let previous = 4;
      for (let t = 0; t <= 1.0001; t += 0.05) {
        const current = rank[statusFor(c, t)];
        expect(current).toBeLessThanOrEqual(previous);
        previous = current;
      }
    }
  });

  it('does not let a lowered bar drag candidates below the reporting floor', () => {
    // The floor is what's worth showing, not what counts as reliable: flooding codegen with
    // sub-0.5 name guesses trades a silent wrong reuse for a noisy one.
    expect(statusFor(CANDIDATE_FLOOR - 0.01, 0)).toBe('unmapped');
    expect(statusFor(CANDIDATE_FLOOR, 0)).toBe('medium'); // clears the bar, not the absolute mark
  });
});
