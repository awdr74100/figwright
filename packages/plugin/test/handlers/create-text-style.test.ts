import type { StyleResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createCreateTextStyleHandler } from '../../src/handlers/create-text-style.js';

/**
 * `missingFont` makes loadFontAsync reject for that family, the way Figma does for a font the user
 * has not installed — the one failure in this handler that caller input can cause.
 */
const fakeFigma = ({ missingFont }: { missingFont?: string } = {}): {
  figma: typeof figma;
  loaded: FontName[];
  style: Record<string, unknown>;
  createTextStyle: ReturnType<typeof vi.fn<() => Record<string, unknown>>>;
} => {
  const loaded: FontName[] = [];
  const style: Record<string, unknown> = { id: 'S:0', name: '' };
  const createTextStyle = vi.fn<() => Record<string, unknown>>(() => style);
  const figmaCtx = {
    createTextStyle,
    loadFontAsync: vi.fn<(fn: FontName) => Promise<void>>(async (fn: FontName) => {
      if (fn.family === missingFont) throw new Error(`Cannot find font ${fn.family}`);
      loaded.push(fn);
    }),
  } as unknown as typeof figma;
  return { figma: figmaCtx, loaded, style, createTextStyle };
};

describe('create_text_style handler', () => {
  it('creates a text style, loading the font before assigning it', async () => {
    const { figma: f, loaded, style } = fakeFigma();
    const handler = createCreateTextStyleHandler(f);
    const result = (await handler({
      name: 'Heading/H1',
      fontName: { family: 'Inter', style: 'Bold' },
      fontSize: 32,
      lineHeight: { unit: 'PERCENT', value: 120 },
      letterSpacing: { unit: 'PIXELS', value: 0 },
    })) as StyleResult;

    // Twice: hoisted before creation (a font the user may not have is the one caller-input
    // failure here), then again as the style's own face, which every typography write below needs
    // loaded. loadFontAsync is cached, so the repeat costs nothing.
    expect(loaded).toEqual([
      { family: 'Inter', style: 'Bold' },
      { family: 'Inter', style: 'Bold' },
    ]);
    expect(style.fontName).toEqual({ family: 'Inter', style: 'Bold' });
    expect(style.fontSize).toBe(32);
    expect(style.lineHeight).toEqual({ unit: 'PERCENT', value: 120 });
    expect(style.letterSpacing).toEqual({ unit: 'PIXELS', value: 0 });
    expect(result).toEqual({ ok: true, styleId: 'S:0', name: 'Heading/H1' });
  });

  it("loads the style's own font before setting textWrapStyle (Figma rejects it otherwise)", async () => {
    // Live Figma answers `Cannot write to node with unloaded font "Inter Regular"` here: unlike
    // fontSize / lineHeight / letterSpacing, this writes through to the style's text runs. With
    // fontName omitted the face is Figma's default on a fresh style, which nothing has loaded yet.
    const { figma: f, loaded, style } = fakeFigma();
    style.fontName = { family: 'Inter', style: 'Regular' };
    await createCreateTextStyleHandler(f)({ name: 'Heading/H1', textWrapStyle: 'BALANCE' });
    expect(style.textWrapStyle).toBe('BALANCE');
    expect(loaded).toEqual([{ family: 'Inter', style: 'Regular' }]);
  });

  it('loads the requested font before creating anything, so a bad font strands no style', async () => {
    // The failure mode this guards: createTextStyle() first, loadFontAsync() after, means an
    // unavailable font leaves an orphan style sitting in the document's style panel that the failed
    // call can no longer reach. Every sibling create_* handler validates before it mutates.
    const { figma: f, createTextStyle } = fakeFigma({ missingFont: 'Nonexistent Sans' });
    await expect(
      createCreateTextStyleHandler(f)({
        name: 'Heading/H1',
        fontName: { family: 'Nonexistent Sans', style: 'Bold' },
      }),
    ).rejects.toThrow(/Nonexistent Sans/);
    expect(createTextStyle).not.toHaveBeenCalled();
  });

  it('throws when name is missing', async () => {
    const { figma: f } = fakeFigma();
    const handler = createCreateTextStyleHandler(f);
    await expect(handler({ fontSize: 12 })).rejects.toThrow(/name/);
  });
});
