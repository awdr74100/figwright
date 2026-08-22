import type { StyleResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createCreateTextStyleHandler } from '../../src/handlers/create-text-style.js';

/**
 * `missingFont` makes loadFontAsync reject for that family, the way Figma does for a font the user
 * has not installed — the one failure in this handler that caller input can cause.
 */
const fakeFigma = (
  { missingFont }: { missingFont?: string } = {},
  variables: Record<string, unknown> = {},
): {
  figma: typeof figma;
  loaded: FontName[];
  style: Record<string, unknown>;
  createTextStyle: ReturnType<typeof vi.fn<() => Record<string, unknown>>>;
  bound: [string, unknown][];
  removed: () => number;
} => {
  const loaded: FontName[] = [];
  const bound: [string, unknown][] = [];
  let removed = 0;
  const style: Record<string, unknown> = {
    id: 'S:0',
    name: '',
    setBoundVariable: (field: string, variable: unknown) => bound.push([field, variable]),
    remove: () => {
      removed += 1;
    },
  };
  const createTextStyle = vi.fn<() => Record<string, unknown>>(() => style);
  const figmaCtx = {
    createTextStyle,
    variables: { getVariableByIdAsync: async (id: string) => variables[id] ?? null },
    loadFontAsync: vi.fn<(fn: FontName) => Promise<void>>(async (fn: FontName) => {
      if (fn.family === missingFont) throw new Error(`Cannot find font ${fn.family}`);
      loaded.push(fn);
    }),
  } as unknown as typeof figma;
  return { figma: figmaCtx, loaded, style, createTextStyle, bound, removed: () => removed };
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

  // Typography values are scalars, so a text style is the only place its bindings can live — there
  // is no per-paint level like a fill has (issue #164).
  it('binds typography fields on the created style', async () => {
    const variable = { id: 'V:1', name: 'size/lg', resolvedType: 'FLOAT', valuesByMode: {} };
    const { figma: f, bound } = fakeFigma({}, { 'V:1': variable });
    await createCreateTextStyleHandler(f)({
      name: 'Heading/H1',
      fontName: { family: 'Inter', style: 'Bold' },
      boundVariables: { fontSize: 'V:1' },
    });
    expect(bound).toEqual([['fontSize', variable]]);
  });

  // The one failure that cannot be hoisted ahead of creation: a binding's target face is only
  // computable once the style's base face is, which is after creation when fontName is omitted.
  // So the orphan gets undone rather than prevented — a style left in the panel would still be
  // published to the library from there.
  it('creates nothing when a binding cannot be resolved', async () => {
    const { figma: f, createTextStyle } = fakeFigma();
    await expect(
      createCreateTextStyleHandler(f)({
        name: 'Heading/H1',
        boundVariables: { fontSize: 'V:gone' },
      }),
    ).rejects.toThrow('create_text_style: variable V:gone not found');
    expect(createTextStyle).not.toHaveBeenCalled();
  });

  // What the resolution hoist above cannot cover: the face a binding lands on is only computable
  // once the style's base face is, i.e. after creation when fontName was omitted. A style left in
  // the panel would still be published to the library from there, so it gets undone.
  it('removes the style it created when the binding itself fails', async () => {
    const variable = { id: 'V:1', name: 'size/lg', resolvedType: 'FLOAT', valuesByMode: {} };
    const { figma: f, style, removed } = fakeFigma({}, { 'V:1': variable });
    style.fontName = { family: 'Inter', style: 'Regular' };
    style.setBoundVariable = () => {
      throw new Error('in setBoundVariable: unloaded font "Roboto Bold"');
    };
    await expect(
      createCreateTextStyleHandler(f)({ name: 'Heading/H1', boundVariables: { fontSize: 'V:1' } }),
    ).rejects.toThrow('unloaded font');
    expect(removed()).toBe(1);
  });

  it('loads the face a fontFamily binding will resolve to before binding it', async () => {
    const variable = {
      id: 'V:f',
      name: 'font/family',
      resolvedType: 'STRING',
      valuesByMode: { m1: 'Roboto' },
    };
    const { figma: f, loaded, style } = fakeFigma({}, { 'V:f': variable });
    style.fontName = { family: 'Inter', style: 'Regular' };
    await createCreateTextStyleHandler(f)({
      name: 'Heading/H1',
      boundVariables: { fontFamily: 'V:f' },
    });
    // Live Figma answers `unloaded font "Roboto Regular"` without this.
    expect(loaded).toContainEqual({ family: 'Roboto', style: 'Regular' });
  });
});
