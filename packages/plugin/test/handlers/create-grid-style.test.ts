import type { StyleResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createCreateGridStyleHandler } from '../../src/handlers/create-grid-style.js';

const fakeFigma = (): { figma: typeof figma; style: Record<string, unknown> } => {
  const style: Record<string, unknown> = { id: 'G:0', name: '' };
  const figmaCtx = { createGridStyle: () => style } as unknown as typeof figma;
  return { figma: figmaCtx, style };
};

describe('create_grid_style handler', () => {
  it('creates a grid style from a uniform GRID', async () => {
    const { figma: f, style } = fakeFigma();
    const handler = createCreateGridStyleHandler(f);
    const result = (await handler({
      name: 'Layout/8pt',
      grids: [{ pattern: 'GRID', visible: true, sectionSize: 8 }],
    })) as StyleResult;

    expect(style.layoutGrids).toEqual([{ pattern: 'GRID', visible: true, sectionSize: 8 }]);
    expect(result).toEqual({ ok: true, styleId: 'G:0', name: 'Layout/8pt' });
  });

  it('throws on bad input', async () => {
    const { figma: f } = fakeFigma();
    const handler = createCreateGridStyleHandler(f);
    await expect(handler({ grids: [] })).rejects.toThrow(/name/);
    await expect(handler({ name: 'x', grids: 'no' })).rejects.toThrow(/grids/);
  });
});
