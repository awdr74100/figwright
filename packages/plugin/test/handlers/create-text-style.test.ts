import type { StyleResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createCreateTextStyleHandler } from '../../src/handlers/create-text-style.js';

const fakeFigma = (): {
  figma: typeof figma;
  loaded: FontName[];
  style: Record<string, unknown>;
} => {
  const loaded: FontName[] = [];
  const style: Record<string, unknown> = { id: 'S:0', name: '' };
  const figmaCtx = {
    createTextStyle: () => style,
    loadFontAsync: vi.fn<(fn: FontName) => Promise<void>>(async (fn: FontName) => {
      loaded.push(fn);
    }),
  } as unknown as typeof figma;
  return { figma: figmaCtx, loaded, style };
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

    expect(loaded).toEqual([{ family: 'Inter', style: 'Bold' }]);
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

  it('throws when name is missing', async () => {
    const { figma: f } = fakeFigma();
    const handler = createCreateTextStyleHandler(f);
    await expect(handler({ fontSize: 12 })).rejects.toThrow(/name/);
  });
});
