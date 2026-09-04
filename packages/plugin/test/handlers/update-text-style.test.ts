import type { StyleResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createUpdateTextStyleHandler } from '../../src/handlers/update-text-style.js';

const fakeFigma = (
  style: Record<string, unknown> | null,
  variables: Record<string, unknown> = {},
): { figma: typeof figma; loaded: FontName[]; bound: [string, unknown][] } => {
  const loaded: FontName[] = [];
  const bound: [string, unknown][] = [];
  if (style !== null) {
    style.setBoundVariable = (field: string, variable: unknown) => bound.push([field, variable]);
  }
  const figmaCtx = {
    getStyleByIdAsync: async () => style,
    variables: { getVariableByIdAsync: async (id: string) => variables[id] ?? null },
    loadFontAsync: vi.fn<(fn: FontName) => Promise<void>>(async (fn: FontName) => {
      loaded.push(fn);
    }),
  } as unknown as typeof figma;
  return { figma: figmaCtx, loaded, bound };
};

describe('update_text_style handler', () => {
  it("assigns a variable font's axis values onto the style", async () => {
    const style: Record<string, unknown> = {
      id: 'S:0',
      type: 'TEXT',
      name: 'Body',
      fontName: { family: 'Inter', style: 'Regular' },
    };
    const { figma: f, loaded } = fakeFigma(style);
    await createUpdateTextStyleHandler(f)({
      styleId: 'S:0',
      fontName: { family: 'Inter', style: 'Regular', variationSettings: { wght: 300 } },
    });
    expect(style.fontName).toEqual({
      family: 'Inter',
      style: 'Regular',
      variationSettings: { wght: 300 },
    });
    expect(loaded[0]).toEqual({
      family: 'Inter',
      style: 'Regular',
      variationSettings: { wght: 300 },
    });
  });

  it('updates given fields (loading a new font first) and leaves omitted ones unchanged', async () => {
    const style: Record<string, unknown> = {
      id: 'S:0',
      type: 'TEXT',
      name: 'old',
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 12,
      lineHeight: { unit: 'AUTO' },
      letterSpacing: { unit: 'PIXELS', value: 0 },
      description: 'keep',
    };
    const { figma: f, loaded } = fakeFigma(style);
    const result = (await createUpdateTextStyleHandler(f)({
      styleId: 'S:0',
      name: 'Heading/H1',
      fontName: { family: 'Inter', style: 'Bold' },
      fontSize: 32,
      lineHeight: { unit: 'PERCENT', value: 120 },
    })) as StyleResult;

    // The new font before assigning it, then the style's now-current face before the typography
    // writes. loadFontAsync is cached, so the repeat is free.
    expect(loaded).toEqual([
      { family: 'Inter', style: 'Bold' },
      { family: 'Inter', style: 'Bold' },
    ]);
    expect(style.name).toBe('Heading/H1');
    expect(style.fontName).toEqual({ family: 'Inter', style: 'Bold' });
    expect(style.fontSize).toBe(32);
    expect(style.lineHeight).toEqual({ unit: 'PERCENT', value: 120 });
    expect(style.letterSpacing).toEqual({ unit: 'PIXELS', value: 0 }); // omitted → unchanged
    expect(style.description).toBe('keep'); // omitted → unchanged
    expect(result).toEqual({ ok: true, styleId: 'S:0', name: 'Heading/H1' });
  });

  it("updates textWrapStyle after loading the style's font, and leaves it alone when omitted", async () => {
    // Live Figma rejects this one against an unloaded font, unlike the numeric fields — it writes
    // through to the style's text runs. The font is loaded even though it is not changing.
    const style: Record<string, unknown> = {
      id: 'S:0',
      type: 'TEXT',
      name: 'Body',
      fontName: { family: 'Inter', style: 'Regular' },
      textWrapStyle: 'AUTO',
    };
    const { figma: f, loaded } = fakeFigma(style);
    await createUpdateTextStyleHandler(f)({ styleId: 'S:0', textWrapStyle: 'PRETTY' });
    expect(style.textWrapStyle).toBe('PRETTY');
    expect(loaded).toEqual([{ family: 'Inter', style: 'Regular' }]);

    await createUpdateTextStyleHandler(f)({ styleId: 'S:0', fontSize: 18 });
    expect(style.textWrapStyle).toBe('PRETTY'); // omitted → unchanged
  });

  // This test used to assert the opposite — that a size-only update loads nothing, on the
  // reasoning that changing a number "touches no glyphs". Live Figma disagrees: it answers
  // `in set_fontSize: Cannot write to node with unloaded font "Inter Regular"`. Since nothing
  // loads a font just by reading a style, that made update_text_style fail on any style the caller
  // had not also re-fonted in the same session — which is most of them.
  it("loads the style's own font even for a numeric-only update (fontName omitted)", async () => {
    const style: Record<string, unknown> = {
      id: 'S:0',
      type: 'TEXT',
      name: 'x',
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 12,
    };
    const { figma: f, loaded } = fakeFigma(style);
    await createUpdateTextStyleHandler(f)({ styleId: 'S:0', fontSize: 16 });
    expect(loaded).toEqual([{ family: 'Inter', style: 'Regular' }]);
    expect(style.fontSize).toBe(16);
  });

  it('throws when the style is missing or not a text style', async () => {
    await expect(
      createUpdateTextStyleHandler(fakeFigma(null).figma)({ styleId: 'S:9' }),
    ).rejects.toThrow(/not found/);
    await expect(
      createUpdateTextStyleHandler(fakeFigma({ id: 'S:0', type: 'PAINT' }).figma)({
        styleId: 'S:0',
      }),
    ).rejects.toThrow(/not found/);
    await expect(createUpdateTextStyleHandler(fakeFigma(null).figma)({})).rejects.toThrow(
      /styleId/,
    );
  });

  it('binds typography fields, and unbinds one passed as null', async () => {
    const variable = { id: 'V:1', name: 'size/lg', resolvedType: 'FLOAT', valuesByMode: {} };
    const style: Record<string, unknown> = {
      id: 'S:0',
      type: 'TEXT',
      name: 'Body',
      fontName: { family: 'Inter', style: 'Regular' },
    };
    const { figma: f, bound } = fakeFigma(style, { 'V:1': variable });
    await createUpdateTextStyleHandler(f)({
      styleId: 'S:0',
      boundVariables: { fontSize: 'V:1', lineHeight: null },
    });
    // A text style write is a patch, so omission cannot mean "unbind" the way it does for the
    // whole-array paints and effects — null is how a caller says it.
    expect(bound).toEqual([
      ['fontSize', variable],
      ['lineHeight', null],
    ]);
  });

  it('applies bindings after literals, so a bound field wins over one set in the same call', async () => {
    const variable = { id: 'V:1', name: 'size/lg', resolvedType: 'FLOAT', valuesByMode: {} };
    const style: Record<string, unknown> = {
      id: 'S:0',
      type: 'TEXT',
      name: 'Body',
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 12,
    };
    const { figma: f, bound } = fakeFigma(style, { 'V:1': variable });
    await createUpdateTextStyleHandler(f)({
      styleId: 'S:0',
      fontSize: 99,
      boundVariables: { fontSize: 'V:1' },
    });
    expect(style.fontSize).toBe(99); // the literal landed first…
    expect(bound).toEqual([['fontSize', variable]]); // …and the binding then took over the field
  });

  it('leaves the style untouched when a binding cannot be resolved', async () => {
    const style: Record<string, unknown> = {
      id: 'S:0',
      type: 'TEXT',
      name: 'Body',
      fontName: { family: 'Inter', style: 'Regular' },
    };
    const { figma: f, bound } = fakeFigma(style);
    await expect(
      createUpdateTextStyleHandler(f)({ styleId: 'S:0', boundVariables: { fontSize: 'V:gone' } }),
    ).rejects.toThrow('update_text_style: variable V:gone not found');
    expect(bound).toEqual([]);
  });
});
