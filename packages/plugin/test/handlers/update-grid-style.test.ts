import type { StyleResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createUpdateGridStyleHandler } from '../../src/handlers/update-grid-style.js';

const fakeFigma = (style: unknown, variables: Record<string, unknown> = {}): typeof figma =>
  ({
    getStyleByIdAsync: async () => style,
    variables: {
      getVariableByIdAsync: async (id: string) => variables[id] ?? null,
      setBoundVariableForLayoutGrid: (grid: object, field: string, v: { id: string }) => ({
        ...grid,
        boundVariables: { [field]: { type: 'VARIABLE_ALIAS', id: v.id } },
      }),
    },
  }) as unknown as typeof figma;

const gridStyle = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'S:g',
  type: 'GRID',
  name: 'Layout/old',
  description: 'old',
  documentationLinks: [{ uri: 'https://old.com' }],
  layoutGrids: [{ pattern: 'GRID', visible: true, sectionSize: 4 }],
  ...over,
});

describe('update_grid_style handler', () => {
  it('updates every field given, in place', async () => {
    const style = gridStyle();
    const result = (await createUpdateGridStyleHandler(
      fakeFigma(style, { 'V:1': { id: 'V:1', resolvedType: 'FLOAT' } }),
    )({
      styleId: 'S:g',
      name: 'Layout/12',
      description: '12 columns',
      documentationLinks: [{ uri: 'https://sb.example.com/grid' }],
      grids: [
        {
          pattern: 'COLUMNS',
          visible: true,
          count: 12,
          gutterSize: 24,
          alignment: 'STRETCH',
          color: { r: 0, g: 0, b: 1, a: 0.2 },
          boundVariables: { gutterSize: 'V:1' },
        },
      ],
    })) as StyleResult;
    expect(result).toEqual({ ok: true, styleId: 'S:g', name: 'Layout/12' });
    expect(style).toMatchObject({
      name: 'Layout/12',
      description: '12 columns',
      documentationLinks: [{ uri: 'https://sb.example.com/grid' }],
      layoutGrids: [
        {
          pattern: 'COLUMNS',
          count: 12,
          color: { r: 0, g: 0, b: 1, a: 0.2 },
          boundVariables: { gutterSize: { type: 'VARIABLE_ALIAS', id: 'V:1' } },
        },
      ],
    });
  });

  it('leaves every field it is not given as it was', async () => {
    const style = gridStyle();
    await createUpdateGridStyleHandler(fakeFigma(style))({ styleId: 'S:g', name: 'renamed' });
    expect(style).toEqual(gridStyle({ name: 'renamed' }));
  });

  it('names a grid colour Figma would refuse, and writes the grids around it', async () => {
    const style = gridStyle();
    const result = (await createUpdateGridStyleHandler(fakeFigma(style))({
      styleId: 'S:g',
      grids: [
        { pattern: 'GRID', visible: true, sectionSize: 8, color: { r: 0, g: 0, b: 1 } },
        { pattern: 'GRID', visible: true, sectionSize: 2, color: { r: 0, g: 1, b: 0, a: 1 } },
      ],
    })) as StyleResult;
    expect(style.layoutGrids).toEqual([
      { pattern: 'GRID', visible: true, sectionSize: 8 },
      { pattern: 'GRID', visible: true, sectionSize: 2, color: { r: 0, g: 1, b: 0, a: 1 } },
    ]);
    expect(result.adjusted).toMatch(/^grids\[0\]\.color was not written \(it has no a\)/);
  });

  it('writes nothing at all when a bound variable cannot be resolved', async () => {
    const writes: string[] = [];
    const style = new Proxy(gridStyle(), {
      set: (t, k, v) => {
        writes.push(String(k));
        return Reflect.set(t, k, v);
      },
    });
    await expect(
      createUpdateGridStyleHandler(fakeFigma(style))({
        styleId: 'S:g',
        name: 'renamed',
        grids: [
          {
            pattern: 'GRID',
            visible: true,
            sectionSize: 8,
            boundVariables: { sectionSize: 'V:gone' },
          },
        ],
      }),
    ).rejects.toThrow('update_grid_style: variable V:gone not found');
    expect(writes).toEqual([]);
  });

  // The link goes first, being the one value Figma refuses on its content, so a refused link
  // leaves the rest untouched without a write and a restore.
  it("passes Figma's refusal of a link on, with the style as it was", async () => {
    const style = gridStyle();
    Object.defineProperty(style, 'documentationLinks', {
      get: () => [{ uri: 'https://old.com' }],
      set: () => {
        throw new Error('in set_documentationLinks: Documentation link must be a URL');
      },
    });
    await expect(
      createUpdateGridStyleHandler(fakeFigma(style))({
        styleId: 'S:g',
        name: 'renamed',
        documentationLinks: [{ uri: 'www.a.com' }],
      }),
    ).rejects.toThrow(/^in set_documentationLinks: Documentation link must be a URL$/);
    expect(style.name).toBe('Layout/old');
  });

  it('puts back what it wrote when Figma refuses a later write', async () => {
    const style = gridStyle();
    let links: unknown = [{ uri: 'https://old.com' }];
    Object.defineProperty(style, 'documentationLinks', {
      enumerable: true,
      get: () => links,
      set: (v: unknown) => {
        links = v;
      },
    });
    Object.defineProperty(style, 'layoutGrids', {
      enumerable: true,
      get: () => [],
      set: () => {
        throw new Error('in set_layoutGrids: refused');
      },
    });
    await expect(
      createUpdateGridStyleHandler(fakeFigma(style))({
        styleId: 'S:g',
        name: 'renamed',
        documentationLinks: [{ uri: 'https://new.com' }],
        grids: [{ pattern: 'GRID', visible: true, sectionSize: 8 }],
      }),
    ).rejects.toThrow(/^in set_layoutGrids: refused$/);
    expect([style.name, links]).toEqual(['Layout/old', [{ uri: 'https://old.com' }]]);
  });

  it('validates its arguments and finds only grid styles', async () => {
    const run = (style: unknown, params: unknown) =>
      createUpdateGridStyleHandler(fakeFigma(style))(params);
    await expect(run(gridStyle(), {})).rejects.toThrow('styleId must be a string');
    await expect(run(gridStyle(), { styleId: 'S:g', grids: {} })).rejects.toThrow(
      'grids must be an array',
    );
    await expect(run(gridStyle(), { styleId: 'S:g', name: 1 })).rejects.toThrow(
      'name must be a string',
    );
    await expect(run(gridStyle(), { styleId: 'S:g', description: 1 })).rejects.toThrow(
      'description must be a string',
    );
    await expect(
      run(gridStyle(), { styleId: 'S:g', documentationLinks: [{ uri: 'a:' }, { uri: 'b:' }] }),
    ).rejects.toThrow('at most one link');
    await expect(run(null, { styleId: 'S:9' })).rejects.toThrow(
      'update_grid_style: grid style S:9 not found',
    );
    await expect(run({ id: 'S:p', type: 'PAINT' }, { styleId: 'S:p' })).rejects.toThrow(
      'not found',
    );
  });
});
