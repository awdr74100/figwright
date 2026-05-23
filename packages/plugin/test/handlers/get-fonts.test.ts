import type { GetFontsResult } from '@figma-mcp-relay/shared';
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

  it('returns empty when the page has no text', async () => {
    const result = (await createGetFontsHandler(fakeFigma([frame('F', [])]))(undefined)) as GetFontsResult;
    expect(result.fonts).toEqual([]);
  });
});
