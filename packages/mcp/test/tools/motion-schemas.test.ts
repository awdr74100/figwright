import { describe, expect, it } from 'vitest';

import {
  animationStyleConfigSchema,
  keyframeFieldSchema,
  keyframeValueSchema,
  manualKeyframeTrackInputSchema,
  motionEasingSchema,
} from '../../src/tools/motion-schemas.js';

describe('motionEasingSchema', () => {
  it('accepts a named preset with no extra params', () => {
    expect(motionEasingSchema.safeParse({ type: 'EASE_OUT' }).success).toBe(true);
  });

  it('accepts CUSTOM_CUBIC_BEZIER with control points and CUSTOM_SPRING with bounce', () => {
    expect(
      motionEasingSchema.safeParse({
        type: 'CUSTOM_CUBIC_BEZIER',
        easingFunctionCubicBezier: { x1: 0.4, y1: 0, x2: 0.2, y2: 1 },
      }).success,
    ).toBe(true);
    expect(
      motionEasingSchema.safeParse({ type: 'CUSTOM_SPRING', easingFunctionSpring: { bounce: 0.5 } })
        .success,
    ).toBe(true);
  });

  it('rejects an unknown easing type and an out-of-range spring bounce', () => {
    expect(motionEasingSchema.safeParse({ type: 'WOBBLE' }).success).toBe(false);
    expect(
      motionEasingSchema.safeParse({ type: 'CUSTOM_SPRING', easingFunctionSpring: { bounce: 2 } })
        .success,
    ).toBe(false);
  });
});

describe('keyframeValueSchema', () => {
  it('accepts a FLOAT and a COLOR value', () => {
    expect(keyframeValueSchema.safeParse({ type: 'FLOAT', value: 120 }).success).toBe(true);
    expect(
      keyframeValueSchema.safeParse({ type: 'COLOR', value: { r: 1, g: 0, b: 0.5, a: 1 } }).success,
    ).toBe(true);
  });

  it('rejects a wrong-typed value, an unknown type, and an out-of-range color channel', () => {
    expect(keyframeValueSchema.safeParse({ type: 'FLOAT', value: 'nope' }).success).toBe(false);
    expect(keyframeValueSchema.safeParse({ type: 'MATRIX', value: 1 }).success).toBe(false);
    expect(
      keyframeValueSchema.safeParse({ type: 'COLOR', value: { r: 2, g: 0, b: 0, a: 1 } }).success,
    ).toBe(false);
  });
});

describe('manualKeyframeTrackInputSchema', () => {
  it('accepts a track with a baseValue and ordered keyframes', () => {
    expect(
      manualKeyframeTrackInputSchema.safeParse({
        baseValue: { type: 'FLOAT', value: 0 },
        keyframes: [
          { timelinePosition: 0, value: { type: 'FLOAT', value: 0 } },
          {
            timelinePosition: 0.3,
            value: { type: 'FLOAT', value: 120 },
            easing: { type: 'EASE_OUT' },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('rejects an empty keyframes array', () => {
    expect(manualKeyframeTrackInputSchema.safeParse({ keyframes: [] }).success).toBe(false);
  });
});

describe('keyframeFieldSchema', () => {
  it('accepts a PROPERTY field and an effects INDEXED_ITEM with a sub-field', () => {
    expect(keyframeFieldSchema.safeParse({ type: 'PROPERTY', name: 'TRANSLATION_X' }).success).toBe(
      true,
    );
    expect(
      keyframeFieldSchema.safeParse({
        type: 'INDEXED_ITEM',
        collection: 'effects',
        index: 0,
        field: 'RADIUS',
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown property name and an unknown discriminant', () => {
    expect(keyframeFieldSchema.safeParse({ type: 'PROPERTY', name: 'WOBBLE' }).success).toBe(false);
    expect(keyframeFieldSchema.safeParse({ type: 'GROUP', index: 0 }).success).toBe(false);
  });
});

describe('animationStyleConfigSchema', () => {
  it('accepts duration + timelineOffset (for stagger) + props', () => {
    expect(
      animationStyleConfigSchema.safeParse({
        duration: 0.4,
        timelineOffset: 0.1,
        props: { direction: 'right', distance: 120 },
      }).success,
    ).toBe(true);
  });

  it('rejects a non-positive duration', () => {
    expect(animationStyleConfigSchema.safeParse({ duration: 0 }).success).toBe(false);
  });
});
