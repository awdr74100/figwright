import { describe, expect, it } from 'vitest';

import { readScene3d, readTransform3d } from '../src/transform3d.js';

const CENTRE = { x: { unit: 'PERCENT', value: 50 }, y: { unit: 'PERCENT', value: 50 } };
const IDENTITY = [
  [1, 0, 0],
  [0, 1, 0],
];

const node = (over: Record<string, unknown>): SceneNode =>
  ({
    type: 'RECTANGLE',
    transformOrigin: CENTRE,
    relativeTransform: IDENTITY,
    ...over,
  }) as unknown as SceneNode;

const fixed = (over: Record<string, unknown> = {}) => ({
  type: 'FIXED_ORDER',
  translateZ: 40,
  rotateX: 0,
  rotateY: 30.000000834826057,
  rotateZ: 0,
  backfaceVisible: true,
  visible: true,
  ...over,
});

describe('readTransform3d', () => {
  it('reads nothing where Figma has no 3D: an older Figma, or a node type without it', () => {
    expect(readTransform3d({ type: 'SECTION' } as unknown as SceneNode)).toEqual({});
  });

  it('reads nothing for no transform', () => {
    expect(readTransform3d(node({ transform3d: { type: 'NONE' } }))).toEqual({});
  });

  it('reads a transform as Figma holds it, float32 noise rounded, defaults left out', () => {
    expect(readTransform3d(node({ transform3d: fixed() }))).toEqual({
      transform3d: { type: 'FIXED_ORDER', translateZ: 40, rotateX: 0, rotateY: 30, rotateZ: 0 },
      cssTransform3d:
        'translate(50%, 50%) translateZ(40px) rotateX(0deg) rotateY(30deg) rotateZ(0deg) ' +
        'translate(-50%, -50%)',
    });
  });

  it('turns about an origin that is not the centre, and reports it', () => {
    const origin = { x: { unit: 'PIXELS', value: -12.5 }, y: { unit: 'PERCENT', value: 100 } };
    const out = readTransform3d(node({ transform3d: fixed(), transformOrigin: origin }));
    expect(out.transformOrigin).toEqual(origin);
    expect(out.cssTransform3d).toBe(
      'translate(-12.5px, 100%) translateZ(40px) rotateX(0deg) rotateY(30deg) rotateZ(0deg) ' +
        'translate(12.5px, -100%)',
    );
  });

  it('marks a hidden back face', () => {
    const out = readTransform3d(node({ transform3d: fixed({ backfaceVisible: false }) }));
    expect(out.transform3d).toMatchObject({ backfaceVisible: false });
    expect(out.cssTransform3d).toBeDefined();
  });

  it('reports a transform switched off, with no CSS — Figma does not draw it', () => {
    const out = readTransform3d(node({ transform3d: fixed({ visible: false }) }));
    expect(out.transform3d).toMatchObject({ type: 'FIXED_ORDER', visible: false });
    expect(out).not.toHaveProperty('cssTransform3d');
  });

  it('reports an imported FREEFORM transform, which has no matrix to write out', () => {
    expect(
      readTransform3d(node({ transform3d: { type: 'FREEFORM', backfaceVisible: false } })),
    ).toEqual({ transform3d: { type: 'FREEFORM', backfaceVisible: false } });
  });

  it('reads nothing for a type it does not know', () => {
    expect(readTransform3d(node({ transform3d: { type: 'MATRIX' } }))).toEqual({});
  });

  it('applies a turned frame’s 3D in its own axes: the turn is cssTransform’s, not repeated', () => {
    const turned = [
      [Math.cos(0.3), -Math.sin(0.3), 5],
      [Math.sin(0.3), Math.cos(0.3), 7],
    ];
    const out = readTransform3d(
      node({ type: 'FRAME', transform3d: fixed(), relativeTransform: turned }),
    );
    expect(out.cssTransform3d).not.toContain('matrix');
  });

  it('folds a turned group’s turn around its 3D, for the group’s unturned wrapper', () => {
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    const out = readTransform3d(
      node({
        type: 'GROUP',
        transform3d: fixed(),
        relativeTransform: [
          [c, -s, 5],
          [s, c, 7],
        ],
      }),
    );
    expect(out.cssTransform3d).toBe(
      'matrix(0.866, 0.5, -0.5, 0.866, 0, 0) translate(50%, 50%) translateZ(40px) rotateX(0deg) ' +
        'rotateY(30deg) rotateZ(0deg) translate(-50%, -50%) matrix(0.866, -0.5, 0.5, 0.866, 0, 0)',
    );
  });

  it('inverts a mirrored group’s turn too', () => {
    const out = readTransform3d(
      node({
        type: 'GROUP',
        transform3d: fixed(),
        relativeTransform: [
          [-1, 0, 50],
          [0, 1, 0],
        ],
      }),
    );
    expect(out.cssTransform3d).toMatch(
      /^matrix\(-1, 0, 0, 1, 0, 0\) .* matrix\(-1, 0, 0, 1, 0, 0\)$/,
    );
  });

  it('leaves an unturned group’s 3D as it is', () => {
    const out = readTransform3d(node({ type: 'GROUP', transform3d: fixed() }));
    expect(out.cssTransform3d).not.toContain('matrix');
  });
});

describe('readScene3d', () => {
  it('reads nothing for a node without a scene, or none set', () => {
    expect(readScene3d({ type: 'RECTANGLE' } as unknown as SceneNode)).toBeUndefined();
    expect(readScene3d(node({ scene3d: null }))).toBeUndefined();
  });

  it('reads a scene, leaving out visible at its default', () => {
    expect(
      readScene3d(node({ scene3d: { perspective: 800, preserve3d: true, visible: true } })),
    ).toEqual({ perspective: 800, preserve3d: true });
  });

  it('keeps a switched-off perspective, which still leaves preserve3d in force', () => {
    expect(
      readScene3d(node({ scene3d: { perspective: -1, preserve3d: false, visible: false } })),
    ).toEqual({ perspective: -1, preserve3d: false, visible: false });
  });
});
