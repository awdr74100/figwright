import type { SerializedTransformModifier } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import {
  MAX_REPEAT_TRANSFORMS,
  renderBoundsOf,
  type RepeatChild,
  repeatTransforms,
  serializeComplexStroke,
  serializeTransformModifiers,
  serializeVariableWidthStroke,
} from '../src/draw.js';

type Affine = RepeatChild['absoluteTransform'];

const at = (x: number, y: number): Affine => [
  [1, 0, x],
  [0, 1, y],
];

const linear = (
  axis: 'HORIZONTAL' | 'VERTICAL',
  offset: number,
  count: number,
  unitType: 'PIXELS' | 'RELATIVE' = 'PIXELS',
): SerializedTransformModifier => ({
  type: 'REPEAT',
  repeatType: 'LINEAR',
  axis,
  unitType,
  offset,
  count,
});

const radial = (
  offset: number,
  count: number,
  unitType: 'PIXELS' | 'RELATIVE' = 'PIXELS',
): SerializedTransformModifier => ({
  type: 'REPEAT',
  repeatType: 'RADIAL',
  unitType,
  offset,
  count,
});

describe('repeatTransforms', () => {
  // Every expectation below is what Figma's own SVG export of the same group writes as its
  // `<use transform>` list (rounded to 2 dp), recorded from live files.

  it('turns a RADIAL copy about a centre straight below the content, offset being the diameter', () => {
    // A 6×20 tick, 12 copies, offset 70: the dial in the live probe.
    const out = repeatTransforms(
      at(57.90011215209961, 39.90011215209961),
      [{ width: 6, height: 20, absoluteTransform: at(100, 40.00000128895044) }],
      [radial(70, 12)],
    );
    expect(out).toHaveLength(11);
    expect(out?.[0]).toBe('translate(28.59px, -16.51px) rotate(30deg)');
    expect(out?.[2]).toBe('translate(90.2px, 0px) rotate(90deg)');
    expect(out?.[5]).toBe('translate(90.2px, 90.2px) rotate(180deg)');
    expect(out?.[10]).toBe('translate(-16.51px, 28.59px) rotate(-30deg)');
  });

  it('repeats everything the first modifier drew, in the order Figma lists the copies', () => {
    // Two ticks 4 px apart, then four of that pair round a circle 30 px across.
    const out = repeatTransforms(
      at(79.5049057006836, 99.5049057006836),
      [{ width: 6, height: 20, absoluteTransform: at(100.00000381469727, 100.00000327825546) }],
      [linear('HORIZONTAL', 4, 2), radial(30, 4)],
    );
    expect(out).toEqual([
      'translate(4px, 0px)',
      'translate(50.99px, 0px) rotate(90deg)',
      'translate(50.99px, 4px) rotate(90deg)',
      'translate(50.99px, 50.99px) rotate(180deg)',
      'translate(46.99px, 50.99px) rotate(180deg)',
      'translate(0px, 50.99px) rotate(-90deg)',
      'translate(0px, 46.99px) rotate(-90deg)',
    ]);
  });

  it('sizes a RELATIVE step from the union of every child', () => {
    // Children spanning 20→216 (196 wide): 1.2 × 196 = 235.2 per copy, then three rows 30 apart.
    const out = repeatTransforms(
      at(20, 20),
      [
        { width: 20, height: 20, absoluteTransform: at(20, 20) },
        { width: 16, height: 16, absoluteTransform: at(200, 20) },
      ],
      [linear('HORIZONTAL', 1.2, 4, 'RELATIVE'), linear('VERTICAL', 30, 3)],
    );
    expect(out).toHaveLength(11);
    expect(out?.slice(0, 4)).toEqual([
      'translate(235.2px, 0px)',
      'translate(470.4px, 0px)',
      'translate(705.6px, 0px)',
      'translate(0px, 30px)',
    ]);
    expect(out?.at(-1)).toBe('translate(705.6px, 60px)');
  });

  it('takes a RELATIVE RADIAL radius from the content height', () => {
    // A 40×10 bar, offset 1: a circle 10 px across, centre 5 px below the bar's centre.
    const out = repeatTransforms(
      at(0, 0),
      [{ width: 40, height: 10, absoluteTransform: at(0, 0) }],
      [radial(1, 2, 'RELATIVE')],
    );
    // A half turn about (20, 10) lands the copy at 2 × centre.
    expect(out).toEqual(['translate(40px, 20px) rotate(180deg)']);
  });

  it('does not grow the content box for a step backwards', () => {
    // Stepping −4 then RELATIVE 1: the second step is the original 10 px, not 14 (measured).
    const out = repeatTransforms(
      at(0, 0),
      [{ width: 10, height: 10, absoluteTransform: at(0, 0) }],
      [linear('VERTICAL', -4, 2), linear('VERTICAL', 1, 2, 'RELATIVE')],
    );
    expect(out).toEqual(['translate(0px, -4px)', 'translate(0px, 10px)', 'translate(0px, 6px)']);
  });

  it('hands the next modifier the square the RADIAL content sweeps, not its copies', () => {
    // A 20×20 square turned about a centre 10 px below its own: its far corners reach
    // hypot(10, 20) ≈ 22.36 out, so the next RELATIVE step is 2 × 22.36 = 44.72.
    const out = repeatTransforms(
      at(0, 0),
      [{ width: 20, height: 20, absoluteTransform: at(0, 0) }],
      [radial(20, 2), linear('HORIZONTAL', 1, 2, 'RELATIVE')],
    );
    expect(out?.[1]).toBe('translate(44.72px, 0px)');
  });

  it('works in the group’s own axes when the group is rotated', () => {
    const turn = (deg: number, x: number, y: number): Affine => {
      const r = (deg * Math.PI) / 180;
      return [
        [Math.cos(r), -Math.sin(r), x],
        [Math.sin(r), Math.cos(r), y],
      ];
    };
    // The same group and child, both turned 30° about the group's origin.
    const flat = repeatTransforms(
      at(0, 0),
      [{ width: 6, height: 20, absoluteTransform: at(12, 0) }],
      [radial(40, 3)],
    );
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    const turned = repeatTransforms(
      turn(30, 100, 50),
      [{ width: 6, height: 20, absoluteTransform: turn(30, 100 + 12 * c, 50 + 12 * s) }],
      [radial(40, 3)],
    );
    expect(turned).toEqual(flat);
  });

  it('gives up rather than guess', () => {
    const child = [{ width: 4, height: 4, absoluteTransform: at(0, 0) }];
    expect(repeatTransforms(at(0, 0), child, [])).toBeUndefined();
    expect(repeatTransforms(at(0, 0), [], [linear('HORIZONTAL', 4, 3)])).toBeUndefined();
    expect(repeatTransforms(at(0, 0), child, [{ type: 'SKEW' }])).toBeUndefined();
    // Too many copies to be worth spelling out.
    const count = Math.ceil(Math.sqrt(MAX_REPEAT_TRANSFORMS + 2));
    expect(
      repeatTransforms(at(0, 0), child, [
        linear('HORIZONTAL', 4, count),
        linear('VERTICAL', 4, count),
      ]),
    ).toBeUndefined();
  });
});

describe('Draw field serializers', () => {
  it('keeps a modifier’s own fields and only the type of one it does not know', () => {
    expect(
      serializeTransformModifiers([
        {
          type: 'REPEAT',
          repeatType: 'LINEAR',
          axis: 'VERTICAL',
          unitType: 'RELATIVE',
          offset: 0.30000001192092896,
          count: 3,
        },
        { type: 'TWIST', amount: 9 },
      ]),
    ).toEqual([
      {
        type: 'REPEAT',
        repeatType: 'LINEAR',
        axis: 'VERTICAL',
        unitType: 'RELATIVE',
        offset: 0.3,
        count: 3,
      },
      { type: 'TWIST' },
    ]);
    expect(serializeTransformModifiers(undefined)).toEqual([]);
  });

  it('reports a brush or dynamic stroke, not the plain one', () => {
    expect(serializeComplexStroke({ type: 'BASIC' })).toBeUndefined();
    expect(serializeComplexStroke(null)).toBeUndefined();
    expect(
      serializeComplexStroke({
        type: 'DYNAMIC',
        frequency: 3,
        wiggle: 0.30000001192092896,
        smoothen: 0.5,
      }),
    ).toEqual({ type: 'DYNAMIC', frequency: 3, wiggle: 0.3, smoothen: 0.5 });
    expect(
      serializeComplexStroke({
        type: 'BRUSH',
        brushType: 'STRETCH',
        brushName: 'NOIR',
        direction: 'BACKWARD',
      }),
    ).toEqual({ type: 'BRUSH', brushType: 'STRETCH', brushName: 'NOIR', direction: 'BACKWARD' });
  });

  it('reports a width profile with its points, not the uniform one', () => {
    expect(
      serializeVariableWidthStroke({ widthProfile: 'UNIFORM', variableWidthPoints: [] }),
    ).toBeUndefined();
    expect(
      serializeVariableWidthStroke({
        widthProfile: 'CUSTOM',
        variableWidthPoints: [
          { position: 0, width: 0.20000000298023224 },
          { position: 1, width: 2.5 },
        ],
      }),
    ).toEqual({
      widthProfile: 'CUSTOM',
      variableWidthPoints: [
        { position: 0, width: 0.2 },
        { position: 1, width: 2.5 },
      ],
    });
  });

  it('reports the painted box only when it differs from the node’s own', () => {
    const box = { x: 40, y: 300, width: 150, height: 23.09 };
    expect(renderBoundsOf({ x: 40.2, y: 300.1, width: 150, height: 23.2 }, box)).toBeUndefined();
    expect(renderBoundsOf(null, box)).toBeUndefined();
    // A dynamic stroke painting well past its path's box.
    expect(renderBoundsOf({ x: 37.16, y: 267.14, width: 155.88, height: 85.86 }, box)).toEqual({
      x: -2.84,
      y: -32.86,
      width: 155.88,
      height: 85.86,
    });
  });

  it('measures from the node’s own x / y, which a rotated node’s bounding box does not start at', () => {
    // A 469 × 59 stroke at (1471.68, 1308) turned −8.86°: its box starts 9.15 px left of its origin.
    const box = { x: 1462.53, y: 1308, width: 472.79, height: 130.95 };
    const render = { x: 1471.08, y: 1285.91, width: 455.92, height: 164.46 };
    expect(renderBoundsOf(render, box)).toMatchObject({ x: 8.55, y: -22.09 });
    expect(renderBoundsOf(render, box, { x: 1471.68, y: 1308 })).toEqual({
      x: -0.6,
      y: -22.09,
      width: 455.92,
      height: 164.46,
    });
  });
});

describe('repeat copies of a turned group', () => {
  it('are written in the parent’s axes, about the group’s origin', () => {
    // Turned 90° counter-clockwise (Figma's [[0, 1], [-1, 0]]): a step along the group's own x
    // axis goes up the page.
    const turned = [
      [0, 1, 0],
      [-1, 0, 0],
    ] as const;
    const child = { width: 10, height: 10, absoluteTransform: turned };
    const step = [
      {
        type: 'REPEAT',
        repeatType: 'LINEAR',
        axis: 'HORIZONTAL',
        unitType: 'PIXELS',
        offset: 20,
        count: 2,
      },
    ] as const;
    expect(repeatTransforms(turned, [child], step)).toEqual(['translate(20px, 0px)']);
    expect(repeatTransforms(turned, [child], step, turned)).toEqual(['translate(0px, -20px)']);
  });
});
