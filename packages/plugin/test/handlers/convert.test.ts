import { describe, expect, it } from 'vitest';

import {
  toDocumentRgb,
  toDocumentRgba,
  toFigmaEffect,
  toFigmaVariableValue,
} from '../../src/handlers/convert.js';

// Stands in for Figma's conversion: what it returns is what a Display P3 file stores for sRGB
// 0.8 / 0.4 / 0.2 (measured live), tagged with the space it came from.
const P3_OF_SRGB_ORANGE = { r: 0.7488, g: 0.4216, b: 0.2478 };

const throwing = (what: string): object =>
  new Proxy(
    {},
    {
      get: () => {
        throw new Error(`${what} must not be read`);
      },
    },
  );

/** A document with the given profile, whose conversion is recorded. */
const doc = (profile: string | undefined) => {
  const calls: unknown[] = [];
  const figmaCtx = {
    root: profile === undefined ? {} : { documentColorProfile: profile },
    util: {
      rgb: (color: unknown) => {
        calls.push(color);
        return { ...P3_OF_SRGB_ORANGE, sourceColor: color };
      },
    },
  } as unknown as typeof figma;
  return { figmaCtx, calls };
};

/** A colour that names no space must not read the document or its conversion at all. */
const untouchable = throwing('figma') as typeof figma;

/** A document whose conversion must not run. */
const noConversion = (profile: string | undefined): typeof figma =>
  ({
    root: profile === undefined ? {} : { documentColorProfile: profile },
    util: throwing('util'),
  }) as unknown as typeof figma;

describe('toDocumentRgb', () => {
  it('passes a colour with no space through as document channels', () => {
    expect(toDocumentRgb(untouchable, { r: 0.8, g: 0.4, b: 0.2 }, 'set_fills')).toStrictEqual({
      r: 0.8,
      g: 0.4,
      b: 0.2,
    });
  });

  it("has Figma convert an sRGB colour into a P3 document, keeping Figma's result whole", () => {
    const { figmaCtx, calls } = doc('DISPLAY_P3');
    const out = toDocumentRgb(figmaCtx, { r: 0.8, g: 0.4, b: 0.2, space: 'SRGB' }, 'set_fills');
    expect(calls).toEqual([{ space: 'SRGB', r: 0.8, g: 0.4, b: 0.2 }]);
    expect(out).toEqual({
      ...P3_OF_SRGB_ORANGE,
      sourceColor: { space: 'SRGB', r: 0.8, g: 0.4, b: 0.2 },
    });
  });

  it('has Figma convert a P3 colour into an sRGB document', () => {
    const { figmaCtx, calls } = doc('SRGB');
    toDocumentRgb(figmaCtx, { r: 1, g: 0, b: 0, space: 'DISPLAY_P3' }, 'set_fills');
    expect(calls).toEqual([{ space: 'DISPLAY_P3', r: 1, g: 0, b: 0 }]);
  });

  // The guarantee that keeps every sRGB file exactly as it was: naming the space a colour is
  // already in writes the same channels, without a round trip through Figma's arithmetic.
  it.each([
    ['SRGB', 'SRGB'],
    ['SRGB', 'LEGACY'],
    ['SRGB', undefined],
    ['DISPLAY_P3', 'DISPLAY_P3'],
  ] as const)('writes a %s colour into a %s document unconverted', (space, profile) => {
    expect(
      toDocumentRgb(noConversion(profile), { r: 0.8, g: 0.4, b: 0.2, space }, 'set_fills'),
    ).toStrictEqual({ r: 0.8, g: 0.4, b: 0.2 });
  });

  it('refuses a space it cannot convert from, naming the tool', () => {
    const { figmaCtx, calls } = doc('DISPLAY_P3');
    expect(() =>
      toDocumentRgb(figmaCtx, { r: 0, g: 0, b: 0, space: 'OKLCH' }, 'set_fills'),
    ).toThrow(/set_fills: color space must be one of SRGB \/ DISPLAY_P3 — got OKLCH/);
    expect(calls).toEqual([]);
  });
});

describe('toDocumentRgba', () => {
  it('converts the channels and leaves alpha alone', () => {
    const { figmaCtx } = doc('DISPLAY_P3');
    const out = toDocumentRgba(figmaCtx, { r: 0.8, g: 0.4, b: 0.2, a: 0.5, space: 'SRGB' }, 'x');
    expect(out).toMatchObject({ ...P3_OF_SRGB_ORANGE, a: 0.5 });
  });
});

describe('toFigmaEffect', () => {
  it('converts a shadow colour that names its space', () => {
    const { figmaCtx } = doc('DISPLAY_P3');
    const effect = toFigmaEffect(
      {
        type: 'DROP_SHADOW',
        visible: true,
        radius: 4,
        color: { r: 0.8, g: 0.4, b: 0.2, a: 0.25, space: 'SRGB' } as never,
        offset: { x: 0, y: 2 },
      },
      figmaCtx,
    ) as DropShadowEffect;
    expect(effect.color).toMatchObject({ ...P3_OF_SRGB_ORANGE, a: 0.25 });
  });

  it('writes a shadow colour with no space exactly as before', () => {
    const effect = toFigmaEffect(
      {
        type: 'INNER_SHADOW',
        visible: true,
        radius: 2,
        color: { r: 1, g: 1, b: 1, a: 1 },
        offset: { x: 0, y: 0 },
      },
      untouchable,
    );
    expect(effect).toEqual({
      type: 'INNER_SHADOW',
      visible: true,
      radius: 2,
      color: { r: 1, g: 1, b: 1, a: 1 },
      offset: { x: 0, y: 0 },
      spread: 0,
      blendMode: 'NORMAL',
    });
  });
});

describe('toFigmaVariableValue', () => {
  it('converts a COLOR value that names its space', () => {
    const { figmaCtx } = doc('DISPLAY_P3');
    const value = toFigmaVariableValue(
      { r: 0.8, g: 0.4, b: 0.2, a: 1, space: 'SRGB' } as never,
      figmaCtx,
    );
    // Exactly the channels: setValueForMode rejects the sourceColor a paint would keep.
    expect(value).toStrictEqual({ ...P3_OF_SRGB_ORANGE, a: 1 });
  });

  it('converts the concrete half of a composed colour that names its space', () => {
    const { figmaCtx } = doc('DISPLAY_P3');
    const value = toFigmaVariableValue(
      {
        color: { r: 0.8, g: 0.4, b: 0.2, a: 1, space: 'SRGB' },
        opacity: { type: 'VARIABLE_ALIAS', id: 'VariableID:1:2' },
      } as never,
      figmaCtx,
    ) as VariableComposedColor;
    expect(value.color).toStrictEqual({ ...P3_OF_SRGB_ORANGE, a: 1 });
    expect(value.opacity).toEqual({ type: 'VARIABLE_ALIAS', id: 'VariableID:1:2' });
  });

  it('writes a COLOR value with no space exactly as before, alpha absent included', () => {
    expect(toFigmaVariableValue({ r: 0.1, g: 0.2, b: 0.3 } as never, untouchable)).toEqual({
      r: 0.1,
      g: 0.2,
      b: 0.3,
      a: undefined,
    });
  });
});
