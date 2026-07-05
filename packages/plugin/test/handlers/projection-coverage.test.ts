import { SerializedNodeSchema, SerializedTextSegmentSchema } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { project } from '../../src/handlers/get-design-context.js';

// Projection-coverage guard. The `full` branch of project() is a hand-copied field list mapping
// serializeFlatSync's output (SerializedNode) into the design-context view — historically this
// repo's most recurring bug class: the serializer emits a dimension and the projection silently
// drops it (textCase/lineHeight, paragraphSpacing, layoutGrids, segments were all found live, one
// by one). This test turns that class into a CI failure: every SerializedNodeSchema key must
// either survive projection at full detail or be explicitly allowlisted below with a reason.
//
// The fixtures are the second half of the ratchet: they must make the serializer emit every
// schema field (each field set to a non-default so the projection's no-op-omission rules don't
// hide it). A new schema field therefore fails this test until the author (a) extends a fixture
// to produce it AND projects it, or (b) records it in an allowlist — a conscious decision either
// way, instead of a silent drop.

/** Deliberately not projected — no codegen meaning, would only bloat the LLM payload. */
const DROPPED = new Map<string, string>([
  ['locked', 'editor lock state — irrelevant to generated code'],
  ['parentId', 'structural; the projected tree shape already encodes parentage'],
]);

/** Carried by buildNode (not project()) at full detail — present in results, out of scope here. */
const HANDLED_ELSEWHERE = new Map<string, string>([
  ['mainComponent', 'resolved async per INSTANCE in buildNode'],
  ['children', 'recursed per node in buildNode'],
]);

const SOLID = { type: 'SOLID', color: { r: 1, g: 0, b: 0 } };

const base = (over: Record<string, unknown>): SceneNode =>
  ({
    id: 'x',
    name: 'x',
    type: 'FRAME',
    visible: true,
    locked: false,
    x: 1,
    y: 2,
    width: 10,
    height: 20,
    parent: null,
    ...over,
  }) as unknown as SceneNode;

// A child of a GRID auto-layout parent: visuals (mixed corners/strokes, effects, mask, blend),
// its own auto-layout, sizing/grow/align/positioning, grid placement, grids, overflow, tokens.
const frameInGrid = base({
  id: 'a',
  visible: false,
  parent: { id: 'gp', layoutMode: 'GRID' },
  rotation: 45,
  opacity: 0.5,
  cornerRadius: Symbol('mixed'),
  topLeftRadius: 8,
  topRightRadius: 0,
  bottomRightRadius: 4,
  bottomLeftRadius: 0,
  blendMode: 'MULTIPLY',
  isMask: true,
  maskType: 'LUMINANCE',
  fills: [SOLID],
  strokes: [SOLID],
  strokeWeight: Symbol('mixed'),
  strokeTopWeight: 1,
  strokeRightWeight: 0,
  strokeBottomWeight: 2,
  strokeLeftWeight: 0,
  strokeAlign: 'CENTER',
  dashPattern: [4, 2],
  strokeCap: 'ROUND',
  strokeJoin: 'BEVEL',
  effects: [
    {
      type: 'DROP_SHADOW',
      visible: true,
      radius: 4,
      color: { r: 0, g: 0, b: 0, a: 0.5 },
      offset: { x: 0, y: 2 },
      spread: 1,
    },
  ],
  layoutMode: 'HORIZONTAL',
  paddingTop: 1,
  paddingRight: 2,
  paddingBottom: 3,
  paddingLeft: 4,
  itemSpacing: 8,
  primaryAxisAlignItems: 'CENTER',
  counterAxisAlignItems: 'MIN',
  layoutWrap: 'WRAP',
  counterAxisSpacing: 12,
  counterAxisAlignContent: 'SPACE_BETWEEN',
  layoutSizingHorizontal: 'FILL',
  layoutSizingVertical: 'HUG',
  layoutGrow: 1,
  layoutAlign: 'STRETCH',
  layoutPositioning: 'ABSOLUTE',
  minWidth: 100,
  maxWidth: 400,
  minHeight: 40,
  maxHeight: 200,
  gridRowAnchorIndex: 1,
  gridColumnAnchorIndex: 2,
  gridRowSpan: 2,
  gridColumnSpan: 3,
  gridChildHorizontalAlign: 'CENTER',
  gridChildVerticalAlign: 'MAX',
  clipsContent: true,
  layoutGrids: [
    { pattern: 'COLUMNS', visible: true, count: 12, gutterSize: 16, alignment: 'MIN', offset: 24 },
  ],
  overflowDirection: 'VERTICAL',
  fillStyleId: 'S:fill',
  strokeStyleId: 'S:stroke',
  effectStyleId: 'S:effect',
  boundVariables: { fills: [{ type: 'VARIABLE_ALIAS', id: 'V:1' }] },
  componentProperties: { Size: { type: 'VARIANT', value: 'lg' } },
});

// Outside auto-layout (parent null) → absolute-positioning constraints; partial-sweep arc.
const arcWithConstraints = base({
  id: 'b',
  type: 'ELLIPSE',
  arcData: { startingAngle: 0, endingAngle: Math.PI, innerRadius: 0.5 },
  constraints: { horizontal: 'MAX', vertical: 'CENTER' },
});

// One run carrying every SerializedTextSegment field, so the segment projection is ratcheted too.
const fullSegment = {
  characters: 'Link',
  start: 0,
  end: 4,
  fontName: { family: 'Inter', style: 'Bold' },
  fontSize: 16,
  fills: [SOLID],
  textDecoration: 'UNDERLINE',
  textCase: 'UPPER',
  lineHeight: { value: 20, unit: 'PIXELS' },
  letterSpacing: { value: 0.5, unit: 'PIXELS' },
  hyperlink: { type: 'URL', value: 'https://example.com' },
  listOptions: { type: 'ORDERED' },
  indentation: 2,
  textStyleId: 'S:seg-text',
  fillStyleId: 'S:seg-fill',
  boundVariables: { fills: [{ type: 'VARIABLE_ALIAS', id: 'V:2' }] },
};

// Mixed-style TEXT (fontSize = symbol → segments) with every node-level text field non-default.
const richText = base({
  id: 'c',
  type: 'TEXT',
  characters: 'Link text',
  fontSize: Symbol('mixed'),
  fontName: { family: 'Inter', style: 'Bold' },
  textAlignHorizontal: 'CENTER',
  textAlignVertical: 'BOTTOM',
  lineHeight: { value: 24, unit: 'PIXELS' },
  letterSpacing: { value: 2, unit: 'PERCENT' },
  textCase: 'UPPER',
  textDecoration: 'UNDERLINE',
  textAutoResize: 'HEIGHT',
  textTruncation: 'ENDING',
  maxLines: 2,
  paragraphSpacing: 8,
  paragraphIndent: 4,
  hyperlink: { type: 'URL', value: 'https://example.com' },
  textStyleId: 'S:text',
  getStyledTextSegments: () => [fullSegment],
});

const FIXTURES = [frameInGrid, arcWithConstraints, richText];

// SerializedNodeSchema is exported as a recursive z.lazy — unwrap to the inner object for keys.
const schemaKeys = Object.keys(
  (SerializedNodeSchema as unknown as { unwrap(): { shape: Record<string, unknown> } }).unwrap()
    .shape,
);
const segmentSchemaKeys = Object.keys(SerializedTextSegmentSchema.shape);

const projected = FIXTURES.map(n => project(n, 'full'));
const projectedKeys = new Set(projected.flatMap(p => Object.keys(p)));
const projectedSegmentKeys = new Set(
  projected.flatMap(p => (p.segments ?? []).flatMap(s => Object.keys(s))),
);

describe('get_design_context projection coverage (full detail)', () => {
  it('projects every serialized node dimension, or allowlists it with a reason', () => {
    const missing = schemaKeys.filter(
      k => !DROPPED.has(k) && !HANDLED_ELSEWHERE.has(k) && !projectedKeys.has(k),
    );
    expect(missing).toEqual([]);
  });

  it('projects every serialized text-segment dimension', () => {
    const missing = segmentSchemaKeys.filter(k => !projectedSegmentKeys.has(k));
    expect(missing).toEqual([]);
  });

  it('never emits a field the serialized schema does not define (typo guard)', () => {
    const unknown = [...projectedKeys].filter(k => !schemaKeys.includes(k));
    const unknownSeg = [...projectedSegmentKeys].filter(k => !segmentSchemaKeys.includes(k));
    expect({ unknown, unknownSeg }).toEqual({ unknown: [], unknownSeg: [] });
  });

  it('keeps the allowlists honest: real schema keys that truly do not project', () => {
    const allowlisted = [...DROPPED.keys(), ...HANDLED_ELSEWHERE.keys()];
    const notInSchema = allowlisted.filter(k => !schemaKeys.includes(k));
    const actuallyProjected = allowlisted.filter(k => projectedKeys.has(k));
    expect({ notInSchema, actuallyProjected }).toEqual({
      notInSchema: [],
      actuallyProjected: [],
    });
  });
});
