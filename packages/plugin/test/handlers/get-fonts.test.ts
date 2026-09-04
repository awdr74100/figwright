import type { GetFontsResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createGetFontsHandler } from '../../src/handlers/get-fonts.js';

const text = (id: string, fontName: unknown, children?: SceneNode[]): SceneNode =>
  ({ id, name: id, type: 'TEXT', fontName, children }) as unknown as SceneNode;

const frame = (id: string, children: SceneNode[]): SceneNode =>
  ({ id, name: id, type: 'FRAME', children }) as unknown as SceneNode;

const fakeFigma = (pageChildren: SceneNode[]): typeof figma =>
  ({ currentPage: { children: pageChildren } }) as unknown as typeof figma;

describe('get_fonts handler', () => {
  it('counts fonts across the page and sorts by frequency desc', async () => {
    const page = [
      frame('F', [
        text('1', { family: 'Inter', style: 'Regular' }),
        text('2', { family: 'Inter', style: 'Regular' }),
        text('3', { family: 'Inter', style: 'Bold' }),
      ]),
      text('4', { family: 'Roboto', style: 'Regular' }),
    ];
    const result = (await createGetFontsHandler(fakeFigma(page))(undefined)) as GetFontsResult;
    expect(result.fonts).toEqual([
      { fontName: { family: 'Inter', style: 'Regular' }, count: 2 },
      { fontName: { family: 'Inter', style: 'Bold' }, count: 1 },
      { fontName: { family: 'Roboto', style: 'Regular' }, count: 1 },
    ]);
  });

  it('expands mixed-font text via styled segments', async () => {
    const mixed = {
      id: 'm',
      name: 'm',
      type: 'TEXT',
      fontName: Symbol('figma.mixed'),
      getStyledTextSegments: () => [
        { fontName: { family: 'Inter', style: 'Regular' } },
        { fontName: { family: 'Inter', style: 'Bold' } },
      ],
    } as unknown as SceneNode;
    const result = (await createGetFontsHandler(fakeFigma([mixed]))(undefined)) as GetFontsResult;
    expect(result.fonts.map(f => f.fontName.style).toSorted()).toEqual(['Bold', 'Regular']);
    expect(result.fonts.every(f => f.count === 1)).toBe(true);
  });

  it("keeps a variable family's axis values apart instead of folding them onto one row", async () => {
    // Same named instance, different rendered weight — collapsing these would report "8 uses of
    // Inter Regular" for a page whose headings and body are visibly different type.
    const page = [
      text('1', { family: 'Inter', style: 'Regular', variationSettings: { wght: 400 } }),
      text('2', { family: 'Inter', style: 'Regular', variationSettings: { wght: 400 } }),
      text('3', { family: 'Inter', style: 'Regular', variationSettings: { wght: 700 } }),
    ];
    const result = (await createGetFontsHandler(fakeFigma(page))(undefined)) as GetFontsResult;
    expect(result.fonts).toEqual([
      {
        fontName: { family: 'Inter', style: 'Regular', variationSettings: { wght: 400 } },
        count: 2,
      },
      {
        fontName: { family: 'Inter', style: 'Regular', variationSettings: { wght: 700 } },
        count: 1,
      },
    ]);
  });

  it('keys axis values by tag, not by the order Figma happens to list them in', async () => {
    const page = [
      text('1', { family: 'Inter', style: 'Regular', variationSettings: { wght: 500, slnt: -4 } }),
      text('2', { family: 'Inter', style: 'Regular', variationSettings: { slnt: -4, wght: 500 } }),
    ];
    const result = (await createGetFontsHandler(fakeFigma(page))(undefined)) as GetFontsResult;
    expect(result.fonts).toHaveLength(1);
    expect(result.fonts[0]?.count).toBe(2);
  });

  it('reports the variation axes of each variable family beside the usage rows', async () => {
    const page = [
      text('1', { family: 'Inter', style: 'Regular' }),
      text('2', { family: 'Courier', style: 'Regular' }),
    ];
    const figmaCtx = {
      ...fakeFigma(page),
      getFontFamilyVariationAxes: (family: string) =>
        family === 'Inter' ? ['wght', 'slnt'] : null,
    } as unknown as typeof figma;
    const result = (await createGetFontsHandler(figmaCtx)(undefined)) as GetFontsResult;
    // Keyed by family, listed once — and a static family is absent rather than present-and-empty.
    expect(result.variationAxes).toEqual({ Inter: ['wght', 'slnt'] });
  });

  it('omits variationAxes on an editor that does not expose the API', async () => {
    const result = (await createGetFontsHandler(
      fakeFigma([text('1', { family: 'Inter', style: 'Regular' })]),
    )(undefined)) as GetFontsResult;
    expect(result.variationAxes).toBeUndefined();
  });

  it('skips a family the editor cannot resolve rather than failing the whole read', async () => {
    // A document with a missing font names a family this editor does not have; the API throws for
    // it. The other families still have to come back.
    const page = [
      text('1', { family: 'Inter', style: 'Regular' }),
      text('2', { family: 'GhostFace', style: 'Regular' }),
    ];
    const figmaCtx = {
      ...fakeFigma(page),
      getFontFamilyVariationAxes: (family: string) => {
        if (family === 'GhostFace') throw new Error('font not available');
        return ['wght'];
      },
    } as unknown as typeof figma;
    const result = (await createGetFontsHandler(figmaCtx)(undefined)) as GetFontsResult;
    expect(result.variationAxes).toEqual({ Inter: ['wght'] });
    expect(result.fonts).toHaveLength(2);
  });

  it('returns empty when the page has no text', async () => {
    const result = (await createGetFontsHandler(fakeFigma([frame('F', [])]))(
      undefined,
    )) as GetFontsResult;
    expect(result.fonts).toEqual([]);
  });
});
