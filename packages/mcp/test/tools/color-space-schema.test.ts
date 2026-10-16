import { describe, expect, it } from 'vitest';

import { effectItemSchema } from '../../src/tools/effect-schema.js';
import { paintItemSchema } from '../../src/tools/paint-schema.js';
import { setVariableValueTool } from '../../src/tools/set-variable-value.js';

// Every colour a write takes can say which space its channels are in, and only the two the plugin
// can convert from. Without one, the colour parses exactly as before.

const variableValue = (value: unknown) =>
  setVariableValueTool.inputSchema.safeParse({ variableId: 'V:1', modeId: 'M:1', value });

describe('colour space on write inputs', () => {
  it('keeps a SOLID colour, a gradient stop and a shadow colour that name their space', () => {
    const solid = paintItemSchema.parse({
      type: 'SOLID',
      color: { r: 0.8, g: 0.4, b: 0.2, space: 'SRGB' },
    });
    expect(solid.color).toEqual({ r: 0.8, g: 0.4, b: 0.2, space: 'SRGB' });

    const gradient = paintItemSchema.parse({
      type: 'GRADIENT_LINEAR',
      gradientStops: [{ position: 0, color: { r: 1, g: 0, b: 0, a: 1, space: 'DISPLAY_P3' } }],
      gradientTransform: [
        [1, 0, 0],
        [0, 1, 0],
      ],
    });
    expect(gradient.gradientStops?.[0]?.color.space).toBe('DISPLAY_P3');

    const shadow = effectItemSchema.parse({
      type: 'DROP_SHADOW',
      visible: true,
      color: { r: 0, g: 0, b: 0, a: 0.25, space: 'SRGB' },
      offset: { x: 0, y: 2 },
    });
    expect(shadow.color?.space).toBe('SRGB');
  });

  it('keeps a COLOR variable value, plain or composed, that names its space', () => {
    const plain = variableValue({ r: 0.8, g: 0.4, b: 0.2, a: 1, space: 'SRGB' });
    expect(plain.success && plain.data.value).toEqual({
      r: 0.8,
      g: 0.4,
      b: 0.2,
      a: 1,
      space: 'SRGB',
    });
    const composed = variableValue({
      color: { r: 0.8, g: 0.4, b: 0.2, a: 1, space: 'SRGB' },
      opacity: { type: 'VARIABLE_ALIAS', id: 'V:2' },
    });
    expect(composed.success).toBe(true);
  });

  it('refuses a space the plugin cannot convert from', () => {
    expect(
      paintItemSchema.safeParse({ type: 'SOLID', color: { r: 0, g: 0, b: 0, space: 'OKLCH' } })
        .success,
    ).toBe(false);
    expect(
      effectItemSchema.safeParse({
        type: 'DROP_SHADOW',
        visible: true,
        color: { r: 0, g: 0, b: 0, a: 1, space: 'srgb' },
        offset: { x: 0, y: 0 },
      }).success,
    ).toBe(false);
    expect(variableValue({ r: 0, g: 0, b: 0, a: 1, space: 'HSL' }).success).toBe(false);
  });

  it('parses a colour with no space exactly as before', () => {
    expect(paintItemSchema.parse({ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }).color).toEqual({
      r: 1,
      g: 0,
      b: 0,
    });
    const plain = variableValue({ r: 1, g: 0, b: 0, a: 1 });
    expect(plain.success && plain.data.value).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });
});
