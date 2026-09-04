import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import type { GetReactionsResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createGetReactionsHandler } from '../../src/handlers/get-reactions.js';
import { createSetReactionsHandler } from '../../src/handlers/set-reactions.js';

// A reaction read out of Figma and written straight back must come back byte-identical. That is the
// documented contract of the get_reactions / set_reactions pair, and it used to be false: both
// mappers picked four fields, so an OVERLAY action lost its overlayRelativePosition, a directional
// transition lost the direction and matchLayers it cannot render without, and SET_VARIABLE /
// SET_VARIABLE_MODE / UPDATE_MEDIA_RUNTIME / CONDITIONAL were written back as a bare `type` —
// destroying the interaction rather than reproducing it (issue #196).
//
// The field list is read out of the installed plugin typings rather than written here, because a
// hand-listed one has exactly the failure mode being fixed: it is a second whitelist, and it would
// go stale the next time Figma adds a field. A new field in a future @figma/plugin-typings joins
// this test on its own, and fails it if either mapper starts picking fields again.

const resolve = createRequire(import.meta.url).resolve;
const TYPINGS = readFileSync(resolve('@figma/plugin-typings/plugin-api.d.ts'), 'utf8');

/**
 * Every property name declared inside one top-level `type X =` / `interface X {` block.
 *
 * The blocks this reads (Trigger, Action, Transition, Easing) are flat: their members are unions of
 * object literals whose own fields are primitives or named types, with no inline nesting. So "lines
 * that look like a property, until the next top-level declaration" is an exact reading of them, not
 * an approximation — and `expect(...).not.toHaveLength(0)` below is what catches it becoming one.
 */
const fieldsOf = (decl: string): string[] => {
  const start = TYPINGS.indexOf(`\n${decl}`);
  if (start === -1) throw new Error(`plugin-api.d.ts has no '${decl}' — the typings moved`);
  const body = TYPINGS.slice(start + 1);
  const end = body.search(/\n(?:\/\*\*|type |interface |declare )/);
  const region = end === -1 ? body : body.slice(0, end);
  const names = [...region.matchAll(/^\s+(?:readonly\s+)?([A-Za-z_]\w*)\??:/gm)].map(m => m[1]!);
  return [...new Set(names)];
};

const TRIGGER_FIELDS = fieldsOf('type Trigger =');
const ACTION_FIELDS = fieldsOf('type Action =');
const TRANSITION_FIELDS = [
  ...new Set([
    ...fieldsOf('interface SimpleTransition {'),
    ...fieldsOf('interface DirectionalTransition {'),
  ]),
];
const EASING_FIELDS = fieldsOf('interface Easing {');

/**
 * A marker per field — the mappers copy values, so what they are matters less than that they
 * arrive.
 */
const fill = (
  fields: readonly string[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> =>
  Object.fromEntries(fields.map(name => [name, overrides[name] ?? `<${name}>`]));

const reactionWithEveryField = () => ({
  trigger: fill(TRIGGER_FIELDS, { type: 'ON_KEY_DOWN', keyCodes: [65, 66] }),
  actions: [
    fill(ACTION_FIELDS, {
      type: 'NODE',
      navigation: 'OVERLAY',
      overlayRelativePosition: { x: 0, y: 4 },
      transition: fill(TRANSITION_FIELDS, {
        type: 'MOVE_IN',
        direction: 'BOTTOM',
        matchLayers: true,
        duration: 0.3,
        easing: fill(EASING_FIELDS, {
          type: 'CUSTOM_CUBIC_BEZIER',
          easingFunctionCubicBezier: { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 },
        }),
      }),
      conditionalBlocks: [
        { condition: { type: 'BOOLEAN', value: true }, actions: [{ type: 'BACK' }] },
      ],
      variableValue: { type: 'FLOAT', resolvedType: 'FLOAT', value: 12 },
    }),
  ],
});

describe('reaction round-trip fidelity', () => {
  it('reads the field surface out of the installed typings', () => {
    // A regex that quietly matched nothing would make every assertion below vacuous.
    expect(TRIGGER_FIELDS).not.toHaveLength(0);
    expect(ACTION_FIELDS).not.toHaveLength(0);
    expect(TRANSITION_FIELDS).not.toHaveLength(0);
    expect(EASING_FIELDS).not.toHaveLength(0);
    // The fields issue #196 was opened about, plus the ones a picked subset dropped with them.
    expect(ACTION_FIELDS).toContain('overlayRelativePosition');
    expect(ACTION_FIELDS).toEqual(
      expect.arrayContaining(['variableId', 'mediaAction', 'conditionalBlocks']),
    );
    expect(TRIGGER_FIELDS).toEqual(expect.arrayContaining(['keyCodes', 'device', 'mediaHitTime']));
    expect(TRANSITION_FIELDS).toEqual(
      expect.arrayContaining(['direction', 'matchLayers', 'easing']),
    );
  });

  it('survives Figma → wire → Figma with every declared field intact', async () => {
    const reaction = reactionWithEveryField();
    const read = (await createGetReactionsHandler({
      getNodeByIdAsync: async () => ({ id: '1:1', reactions: [reaction] }),
    } as unknown as typeof figma)({ nodeId: '1:1' })) as GetReactionsResult;

    expect(read.reactions).toEqual([reaction]);

    const setReactionsAsync = vi.fn<() => Promise<void>>(async () => {});
    await createSetReactionsHandler({
      getNodeByIdAsync: async () => ({ id: '1:1', setReactionsAsync }),
    } as unknown as typeof figma)({ nodeId: '1:1', reactions: read.reactions });

    expect(setReactionsAsync).toHaveBeenCalledWith([reaction]);
  });

  it('anchors an overlay to its trigger without disturbing the rest of the action', async () => {
    // The issue's own repro, minus overlayPosition: that field is not on Action at all. Its real
    // name is overlayPositionType, it lives on the destination frame (FramePrototypingMixin), and
    // it is readonly there — no plugin can set it. Figma honours the offset below only once that
    // frame's overlay position is Manual, which is chosen in Figma.
    const setReactionsAsync = vi.fn<() => Promise<void>>(async () => {});
    const action = {
      type: 'NODE',
      destinationId: '2:2',
      navigation: 'OVERLAY',
      transition: null,
      overlayRelativePosition: { x: 0, y: 4 },
    };
    await createSetReactionsHandler({
      getNodeByIdAsync: async () => ({ id: '1:1', setReactionsAsync }),
    } as unknown as typeof figma)({
      nodeId: '1:1',
      reactions: [{ trigger: { type: 'ON_CLICK' }, actions: [action] }],
    });

    expect(setReactionsAsync).toHaveBeenCalledWith([
      { trigger: { type: 'ON_CLICK' }, actions: [action] },
    ]);
  });
});
