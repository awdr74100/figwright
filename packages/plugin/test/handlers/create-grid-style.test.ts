import type { StyleResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createCreateGridStyleHandler } from '../../src/handlers/create-grid-style.js';

const fakeFigma = (
  variables: Record<string, unknown> = {},
): { figma: typeof figma; style: Record<string, unknown>; creations: () => number } => {
  const style: Record<string, unknown> = { id: 'G:0', name: '' };
  let created = 0;
  const figmaCtx = {
    variables: {
      getVariableByIdAsync: async (id: string) => variables[id] ?? null,
      setBoundVariableForLayoutGrid: (grid: object, field: string, v: { id: string }) => ({
        ...grid,
        boundVariables: { [field]: { type: 'VARIABLE_ALIAS', id: v.id } },
      }),
    },
    createGridStyle: () => {
      created += 1;
      return style;
    },
  } as unknown as typeof figma;
  return { figma: figmaCtx, style, creations: () => created };
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

  it('creates nothing when a bound variable cannot be resolved', async () => {
    const { figma: f, creations } = fakeFigma();
    await expect(
      createCreateGridStyleHandler(f)({
        name: 'Layout/8pt',
        grids: [
          {
            pattern: 'GRID',
            visible: true,
            sectionSize: 8,
            boundVariables: { sectionSize: 'V:x' },
          },
        ],
      }),
    ).rejects.toThrow('create_grid_style: variable V:x not found');
    expect(creations()).toBe(0);
  });

  it('carries a grid binding onto the created style', async () => {
    const { figma: f, style } = fakeFigma({
      'V:1': { id: 'V:1', name: 'size/gutter', resolvedType: 'FLOAT' },
    });
    await createCreateGridStyleHandler(f)({
      name: 'Layout/12col',
      grids: [
        {
          pattern: 'COLUMNS',
          visible: true,
          count: 12,
          gutterSize: 16,
          alignment: 'STRETCH',
          boundVariables: { gutterSize: 'V:1' },
        },
      ],
    });
    expect(style.layoutGrids).toEqual([
      expect.objectContaining({
        boundVariables: { gutterSize: { type: 'VARIABLE_ALIAS', id: 'V:1' } },
      }),
    ]);
  });
});
