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

// Measured on main: a value Figma refuses only surfaces on the write, after the style exists, and
// the failed call left the empty, named style in the file. It is removed now; if even that fails,
// the error says so.
const refusingLayoutgridsStyle = (valueProp: string, removable = true) => {
  const state = { removed: 0 };
  const style: Record<string, unknown> = {
    id: 'S:new',
    name: '',
    description: '',
    remove: () => {
      if (!removable) throw new Error('in remove: refused');
      state.removed += 1;
    },
  };
  Object.defineProperty(style, valueProp, {
    get: () => [],
    set: () => {
      throw new Error(`in set_${valueProp}: Property "${valueProp}" failed validation`);
    },
  });
  return { style, state };
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

  it("creates a grid style with each grid's colour", async () => {
    const { figma: f, style } = fakeFigma();
    await createCreateGridStyleHandler(f)({
      name: 'Layout/blue',
      grids: [
        { pattern: 'GRID', visible: true, sectionSize: 8, color: { r: 0, g: 0, b: 1, a: 0.2 } },
      ],
    });
    expect(style.layoutGrids).toEqual([
      { pattern: 'GRID', visible: true, sectionSize: 8, color: { r: 0, g: 0, b: 1, a: 0.2 } },
    ]);
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

  it('still creates the style when a colour cannot be written, and names it', async () => {
    const { figma: f, style } = fakeFigma();
    const result = (await createCreateGridStyleHandler(f)({
      name: 'Layout/x',
      grids: [{ pattern: 'GRID', visible: true, sectionSize: 8, color: { r: 0, g: 0, b: 1 } }],
    })) as StyleResult;
    expect(style.layoutGrids).toEqual([{ pattern: 'GRID', visible: true, sectionSize: 8 }]);
    expect(result.adjusted).toMatch(/^grids\[0\]\.color was not written \(it has no a\)/);
  });

  it('removes the style it created when Figma refuses its value, and passes the refusal on', async () => {
    const { style, state } = refusingLayoutgridsStyle('layoutGrids');
    const figmaCtx = {
      variables: {
        getVariableByIdAsync: async () => null,
        setBoundVariableForLayoutGrid: (g: object) => g,
      },
      createGridStyle: () => style,
    } as unknown as typeof figma;
    await expect(
      createCreateGridStyleHandler(figmaCtx)({
        name: 'Cols',
        grids: [{ pattern: 'GRID', visible: true, sectionSize: 8 }],
      }),
    ).rejects.toThrow(/^in set_layoutGrids: Property "layoutGrids" failed validation$/);
    expect(state.removed).toBe(1);
  });

  it('says so when the style it created cannot be removed', async () => {
    const { style } = refusingLayoutgridsStyle('layoutGrids', false);
    const figmaCtx = {
      variables: {
        getVariableByIdAsync: async () => null,
        setBoundVariableForLayoutGrid: (g: object) => g,
      },
      createGridStyle: () => style,
    } as unknown as typeof figma;
    await expect(
      createCreateGridStyleHandler(figmaCtx)({
        name: 'Cols',
        grids: [{ pattern: 'GRID', visible: true, sectionSize: 8 }],
      }),
    ).rejects.toThrow(
      'failed validation — and the new style S:new could not be removed: in remove: refused',
    );
  });
});
