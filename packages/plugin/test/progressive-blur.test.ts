import { describe, expect, it } from 'vitest';

import { cssProgressiveBlurLayers, progressiveMaskLine } from '../src/progressive-blur.js';

// The expected values are the recipe that was rendered in Chrome and measured against Figma's own
// renders (mean |Δ| 2.2–2.5 for background blurs, 0.7–1.0 for layer blurs), recomputed independently.

describe('progressiveMaskLine', () => {
  it.each([
    ['left → right on a square', 200, 200, { x: 0, y: 0.5 }, { x: 1, y: 0.5 }, 90, 0, 100],
    ['top → bottom', 240, 240, { x: 0.5, y: 0 }, { x: 0.5, y: 1 }, 180, 0, 100],
    ['bottom → top', 200, 200, { x: 0.5, y: 1 }, { x: 0.5, y: 0 }, 0, 0, 100],
    // The node's proportions turn the angle, and offsets inside the box land inside the line.
    [
      'diagonal, inside a 200×120 box',
      200,
      120,
      { x: 0.2, y: 0.3 },
      { x: 0.8, y: 0.9 },
      120.96,
      22.65,
      82.65,
    ],
    ['corner to corner of a 200×120 box', 200, 120, { x: 0, y: 0 }, { x: 1, y: 1 }, 120.96, 0, 100],
  ] as const)('%s', (_name, w, h, start, end, angle, from, to) => {
    const line = progressiveMaskLine(w, h, start, end);
    expect(line.angle).toBeCloseTo(angle, 2);
    expect(line.from).toBeCloseTo(from, 2);
    expect(line.to).toBeCloseTo(to, 2);
  });
});

describe('cssProgressiveBlurLayers', () => {
  it('stacks a background blur so the overlays add up to the radius in quadrature', () => {
    expect(
      cssProgressiveBlurLayers(
        {
          type: 'BACKGROUND_BLUR',
          radius: 20,
          startRadius: 4,
          startOffset: { x: 0.5, y: 1 },
          endOffset: { x: 0.5, y: 0 },
        },
        { width: 200, height: 200 },
      ),
    ).toEqual([
      'backdrop-filter: blur(1.72px)',
      'backdrop-filter: blur(2.98px); mask-image: linear-gradient(0.00deg, transparent 0.00%, black 25.00%)',
      'backdrop-filter: blur(3.85px); mask-image: linear-gradient(0.00deg, transparent 25.00%, black 50.00%)',
      'backdrop-filter: blur(4.55px); mask-image: linear-gradient(0.00deg, transparent 50.00%, black 75.00%)',
      'backdrop-filter: blur(5.16px); mask-image: linear-gradient(0.00deg, transparent 75.00%, black 100.00%)',
    ]);
  });

  it('stacks blurred copies for a layer blur, each at its full target, over the sharp content', () => {
    expect(
      cssProgressiveBlurLayers(
        {
          type: 'LAYER_BLUR',
          radius: 16,
          startRadius: 0,
          startOffset: { x: 0.5, y: 0 },
          endOffset: { x: 0.5, y: 1 },
        },
        { width: 240, height: 240 },
      ),
    ).toEqual([
      'filter: none',
      'filter: blur(1.72px); mask-image: linear-gradient(180.00deg, transparent 0.00%, black 25.00%)',
      'filter: blur(3.44px); mask-image: linear-gradient(180.00deg, transparent 25.00%, black 50.00%)',
      'filter: blur(5.16px); mask-image: linear-gradient(180.00deg, transparent 50.00%, black 75.00%)',
      'filter: blur(6.88px); mask-image: linear-gradient(180.00deg, transparent 75.00%, black 100.00%)',
    ]);
  });

  it('starts a sharp background blur with no base layer', () => {
    const layers = cssProgressiveBlurLayers(
      {
        type: 'BACKGROUND_BLUR',
        radius: 16,
        startRadius: 0,
        startOffset: { x: 0, y: 0.5 },
        endOffset: { x: 1, y: 0.5 },
      },
      { width: 200, height: 200 },
    );
    expect(layers).toHaveLength(4);
    expect(layers?.[0]).toBe(
      'backdrop-filter: blur(1.72px); mask-image: linear-gradient(90.00deg, transparent 0.00%, black 25.00%)',
    );
  });

  it.each([
    ['an effect style, which has no node', null],
    ['a node with no area', { width: 0, height: 40 }],
  ] as const)('has no CSS for %s', (_name, size) => {
    const blur = {
      type: 'LAYER_BLUR',
      radius: 8,
      startRadius: 0,
      startOffset: { x: 0, y: 0 },
      endOffset: { x: 1, y: 1 },
    } as const;
    expect(cssProgressiveBlurLayers(blur, size)).toBeUndefined();
  });

  it('has no CSS for a ramp with no length', () => {
    const same = { x: 0.5, y: 0.5 };
    expect(
      cssProgressiveBlurLayers(
        { type: 'LAYER_BLUR', radius: 8, startRadius: 0, startOffset: same, endOffset: same },
        { width: 100, height: 100 },
      ),
    ).toBeUndefined();
  });
});
