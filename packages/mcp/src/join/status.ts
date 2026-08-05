import type { MappingStatus } from './component-map.js';

// The one confidence→status bucketing shared by all three joins (component / icon / token). They
// grade the same kind of guess against the same caller-supplied bar, so a rule that drifted between
// them would make `threshold` mean different things per tool.
//
// What the buckets are FOR (see skills/figma-codegen): `high` and `medium` both mean "reuse this,
// don't regenerate"; `low` means "a candidate exists, but decide for yourself". So the boundary
// between medium and low is the reuse decision, and `threshold` is exactly the caller's bar for it.
//
// Which is why threshold has to bind the top bucket too. A caller raising it past HIGH_CONFIDENCE
// is saying "0.85 similarity isn't good enough for me to reuse on" — usually after a wrong reuse,
// which is a silent visual bug. Grading such a match `high` anyway (as a hardcoded top cut does)
// ignores the request in the one direction where being wrong actually costs something, so `high`
// requires clearing BOTH the absolute mark and the caller's bar.

/** Absolute similarity above which a match is confident on its own terms. */
const HIGH_CONFIDENCE = 0.85;

/**
 * Floor for reporting a candidate at all. Deliberately NOT lowered by `threshold`: the bar governs
 * what counts as reliable, while this governs what's worth showing, and flooding codegen with
 * sub-0.5 name guesses trades a silent wrong reuse for a noisy one.
 */
export const CANDIDATE_FLOOR = 0.5;

/**
 * Grade a confidence against the caller's reliability bar. Monotonic in both arguments: raising
 * `threshold` can only ever demote a mapping, never promote one.
 */
export const statusFor = (confidence: number, threshold: number): MappingStatus => {
  // The floor is checked first so it holds regardless of the bar — a bar of 0 asks for a lenient
  // grade, not for sub-floor noise to be graded at all.
  if (confidence < CANDIDATE_FLOOR) return 'unmapped';
  if (confidence >= Math.max(HIGH_CONFIDENCE, threshold)) return 'high';
  if (confidence >= threshold) return 'medium';
  return 'low';
};
