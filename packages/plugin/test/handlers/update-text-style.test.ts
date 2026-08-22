import type { StyleResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createUpdateTextStyleHandler } from '../../src/handlers/update-text-style.js';

const fakeFigma = (
  style: Record<string, unknown> | null,
): { figma: typeof figma; loaded: FontName[] } => {
  const loaded: FontName[] = [];
  const figmaCtx = {
    getStyleByIdAsync: async () => style,
    loadFontAsync: vi.fn<(fn: FontName) => Promise<void>>(async (fn: FontName) => {
      loaded.push(fn);
    }),
  } as unknown as typeof figma;
  return { figma: figmaCtx, loaded };
};

describe('update_text_style handler', () => {
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
});
