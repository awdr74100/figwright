import { DesignContextNodeSchema, LAYOUT_TIER_FIELDS } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

// The drift ratchet for the LAYOUT downgrade tier.
//
// `LAYOUT_TIER_FIELDS` is a hand-copied field list, and this repo's most recurring bug class is
// exactly that: a new dimension lands in the serializer, and a hand-copied projection silently stops
// carrying it. For the layout tier the failure is invisible in the worst way — the payload still
// looks complete, it just quietly loses the flex/grid/padding/gap of one dimension, and the caller
// goes back to reconstructing spacing from coordinates (issue #161).
//
// So: every field DesignContextNodeSchema defines must be classified exactly once — carried by the
// tier, part of the compact base it builds on, or explicitly listed below as appearance. A new
// schema field fails this test until someone decides which side it is on.

/** Identity/geometry/structural flags the compact base already emits (see projectToCompact). */
const COMPACT_BASE = [
  'id',
  'name',
  'type',
  'visible',
  'x',
  'y',
  'width',
  'height',
  'mainComponentId',
  'truncated',
  'deduped',
  'children',
] as const;

/**
 * Fields the tier deliberately drops: appearance, typography and token bindings — the expensive
 * half a caller re-grounds per section. Each carries the reason it is not structure.
 */
const APPEARANCE: Record<string, string> = {
  rotation: 'transform, not flow',
  opacity: 'appearance',
  cornerRadius: 'appearance',
  cornerRadii: 'appearance',
  blendMode: 'appearance',
  isMask: 'appearance (clipping is realised from the mask layer, needs its geometry + paint)',
  maskType: 'appearance',
  arcData: 'shape geometry, rendered as SVG/gradient — appearance',
  fills: 'appearance',
  strokes: 'appearance',
  strokeWeight: 'appearance',
  strokeWeights: 'appearance',
  strokeAlign: 'appearance',
  dashPattern: 'appearance',
  strokeCap: 'appearance',
  strokeJoin: 'appearance',
  effects: 'appearance',
  fontSize: 'typography',
  fontName: 'typography',
  lineHeight: 'typography',
  letterSpacing: 'typography',
  textCase: 'typography',
  textDecoration: 'typography',
  paragraphSpacing: 'typography',
  paragraphIndent: 'typography',
  textWrapStyle: 'typography',
  hyperlink: 'content styling, recovered when the section is re-grounded',
  segments: 'per-run typography — the single largest text-side cost',
  styleIds: 'token binding',
  boundVariables: 'token binding — measured as the single largest field cost in a full payload',
  motion: 'animation, not layout',
  mainComponent: 'full-only resolved object; mainComponentId carries identity in the compact base',
  fill: 'globalVars ref (appearance)',
  stroke: 'globalVars ref (appearance)',
  effect: 'globalVars ref (appearance)',
  textStyle: 'globalVars ref (typography)',
  propertyOverrides: 'per-instance appearance; textOverrides carries the per-instance content',
};

/** Unwrap the z.lazy wrapper so the object shape is reachable (public ZodLazy.unwrap). */
const schemaFieldNames = (): string[] => {
  const lazy = DesignContextNodeSchema as unknown as { unwrap: () => { shape: object } };
  return Object.keys(lazy.unwrap().shape);
};

describe('LAYOUT tier coverage', () => {
  const schemaFields = schemaFieldNames();

  it('reaches the schema shape (guards the unwrap itself)', () => {
    expect(schemaFields).toContain('layout');
    expect(schemaFields).toContain('fills');
    expect(schemaFields.length).toBeGreaterThan(40);
  });

  it('classifies every schema field exactly once', () => {
    const classified = new Map<string, string>();
    const dupes: string[] = [];
    for (const [bucket, fields] of [
      ['compact-base', COMPACT_BASE as readonly string[]],
      ['layout-tier', LAYOUT_TIER_FIELDS as readonly string[]],
      ['appearance', Object.keys(APPEARANCE)],
    ] as const) {
      for (const f of fields) {
        if (classified.has(f)) dupes.push(`${f} (${classified.get(f) as string} + ${bucket})`);
        classified.set(f, bucket);
      }
    }
    expect(dupes).toEqual([]);

    // Guidance rides inside the compared value so it shows up in the CI failure output — oxlint's
    // valid-expect forbids expect()'s second message argument.
    const problems: string[] = [];
    const unclassified = schemaFields.filter(f => !classified.has(f));
    if (unclassified.length > 0) {
      problems.push(
        `New DesignContextNode field(s) [${unclassified.join(', ')}] — decide which side of the ` +
          'LAYOUT downgrade each belongs on: add it to LAYOUT_TIER_FIELDS if it describes how a box ' +
          'is sized, placed, flowed or what it says, or to APPEARANCE in this test (with a reason) ' +
          'if it is colour / typography / effects / tokens.',
      );
    }
    // A stale entry hides a rename: the tier would silently stop carrying the renamed field.
    const stale = [...classified.keys()].filter(f => !schemaFields.includes(f));
    if (stale.length > 0) {
      problems.push(
        `Classified field(s) [${stale.join(', ')}] are no longer in DesignContextNodeSchema — ` +
          'renamed or removed; update the classification.',
      );
    }
    expect(problems).toEqual([]);
  });

  it('carries the fields the reported bug is about', () => {
    // Named explicitly so a future refactor cannot quietly drop the ones that decide whether a
    // caller emits a container with gap/padding or per-child margins.
    for (const f of ['layout', 'layoutSizingHorizontal', 'layoutSizingVertical', 'constraints']) {
      expect(LAYOUT_TIER_FIELDS as readonly string[]).toContain(f);
    }
  });
});
