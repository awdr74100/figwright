import { describe, expect, it } from 'vitest';

import { boundingBoxOf, orientationOf } from '../src/orientation.js';

/** Figma's transform for a turn of `deg` (counter-clockwise), mirrored when `flip`. */
const figma = (deg: number, flip = false): Transform => {
  const t = (deg * Math.PI) / 180;
  const [a, b, c, d] = [Math.cos(t), -Math.sin(t), Math.sin(t), Math.cos(t)];
  // A flip reverses the node's own y axis: the second column changes sign.
  return flip
    ? [
        [a, -c, 5],
        [b, -d, 7],
      ]
    : [
        [a, c, 5],
        [b, d, 7],
      ];
};

describe('orientationOf', () => {
  it.each([
    ['upright', figma(0), false, undefined],
    ['turned 30° counter-clockwise (CSS turns clockwise)', figma(30), false, 'rotate(-30deg)'],
    ['flipped top to bottom (rotation reads 0)', figma(0, true), true, 'scaleY(-1)'],
    ['flipped left to right (rotation reads 180)', figma(180, true), true, 'scaleX(-1)'],
    ['turned and flipped', figma(30, true), true, 'rotate(-30deg) scaleY(-1)'],
  ])('%s', (_label, m, flipped, css) => {
    expect(orientationOf(m)).toEqual({ flipped, cssTransform: css });
  });

  it('writes a transform that also scales or skews as a matrix', () => {
    expect(
      orientationOf([
        [2, 0.5, 0],
        [0, 1, 0],
      ]),
    ).toEqual({ flipped: false, cssTransform: 'matrix(2, 0, 0.5, 1, 0, 0)' });
  });

  it('gives a turned box the bounding box an auto-layout row reserves (measured: 116.6 px)', () => {
    expect(boundingBoxOf(figma(30), 100, 60)).toEqual({
      x: 0,
      y: -50,
      width: 116.6,
      height: 101.96,
    });
    // Flipped top to bottom: the box hangs above its origin.
    expect(boundingBoxOf(figma(0, true), 50, 30)).toEqual({ x: 0, y: -30, width: 50, height: 30 });
  });
});
