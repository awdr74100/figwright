import type { MutateResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createSetLayoutGridsHandler } from '../../src/handlers/set-layout-grids.js';

const fakeFigma = (
  lookup: Record<string, unknown>,
  variables: Record<string, unknown> = {},
): typeof figma =>
  ({
    getNodeByIdAsync: async (id: string) => lookup[id] ?? null,
    variables: {
      getVariableByIdAsync: async (id: string) => variables[id] ?? null,
      setBoundVariableForLayoutGrid: (grid: object, field: string, v: { id: string }) => ({
        ...grid,
        boundVariables: { [field]: { type: 'VARIABLE_ALIAS', id: v.id } },
      }),
    },
  }) as unknown as typeof figma;

describe('set_layout_grids handler', () => {
  it('sets a 12-column grid on a frame (the responsive column scaffold)', async () => {
    const frame = { id: '1:1', layoutGrids: [] as unknown[] };
    const handler = createSetLayoutGridsHandler(fakeFigma({ '1:1': frame }));
    const result = (await handler({
      nodeId: '1:1',
      grids: [
        {
          pattern: 'COLUMNS',
          visible: true,
          count: 12,
          gutterSize: 24,
          alignment: 'STRETCH',
          offset: 32,
        },
      ],
    })) as MutateResult;
    expect(frame.layoutGrids).toEqual([
      {
        pattern: 'COLUMNS',
        visible: true,
        count: 12,
        gutterSize: 24,
        alignment: 'STRETCH',
        offset: 32,
      },
    ]);
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  // A grid read from get_node carries its colour; writing it back must keep it rather than reset it
  // to Figma's red at 10%, as every write here used to.
  it("writes a grid's colour when given, and leaves it to Figma when not", async () => {
    const frame = { id: '1:1', layoutGrids: [] as unknown[] };
    await createSetLayoutGridsHandler(fakeFigma({ '1:1': frame }))({
      nodeId: '1:1',
      grids: [
        { pattern: 'GRID', visible: true, sectionSize: 8, color: { r: 0, g: 0.5, b: 1, a: 0.3 } },
        {
          pattern: 'ROWS',
          visible: true,
          count: 3,
          gutterSize: 8,
          alignment: 'CENTER',
          sectionSize: 40,
          color: { r: 1, g: 0, b: 1, a: 0.15 },
        },
        { pattern: 'COLUMNS', visible: true, count: 2, gutterSize: 4, alignment: 'STRETCH' },
      ],
    });
    expect(frame.layoutGrids).toEqual([
      { pattern: 'GRID', visible: true, sectionSize: 8, color: { r: 0, g: 0.5, b: 1, a: 0.3 } },
      {
        pattern: 'ROWS',
        visible: true,
        count: 3,
        gutterSize: 8,
        alignment: 'CENTER',
        sectionSize: 40,
        color: { r: 1, g: 0, b: 1, a: 0.15 },
      },
      {
        pattern: 'COLUMNS',
        visible: true,
        count: 2,
        gutterSize: 4,
        alignment: 'STRETCH',
        offset: 0,
      },
    ]);
  });

  it('omits offset on a CENTER grid (Figma rejects the key there)', async () => {
    const frame = { id: '1:1', layoutGrids: [] as unknown[] };
    const handler = createSetLayoutGridsHandler(fakeFigma({ '1:1': frame }));
    await handler({
      nodeId: '1:1',
      // A CENTER grid needs sectionSize and must NOT carry offset; the converter drops offset here.
      grids: [
        {
          pattern: 'COLUMNS',
          visible: true,
          count: 6,
          alignment: 'CENTER',
          sectionSize: 64,
          offset: 40,
        },
      ],
    });
    expect(frame.layoutGrids).toEqual([
      {
        pattern: 'COLUMNS',
        visible: true,
        count: 6,
        gutterSize: 0,
        alignment: 'CENTER',
        sectionSize: 64,
      },
    ]);
    expect((frame.layoutGrids[0] as { offset?: number }).offset).toBeUndefined();
  });

  it('sets a uniform GRID (baseline) grid', async () => {
    const frame = { id: '1:1', layoutGrids: [] as unknown[] };
    const handler = createSetLayoutGridsHandler(fakeFigma({ '1:1': frame }));
    await handler({ nodeId: '1:1', grids: [{ pattern: 'GRID', visible: true, sectionSize: 8 }] });
    expect(frame.layoutGrids).toEqual([{ pattern: 'GRID', visible: true, sectionSize: 8 }]);
  });

  it('clears grids when passed an empty array', async () => {
    const frame = {
      id: '1:1',
      layoutGrids: [{ pattern: 'GRID', visible: true, sectionSize: 8 }] as unknown[],
    };
    const handler = createSetLayoutGridsHandler(fakeFigma({ '1:1': frame }));
    await handler({ nodeId: '1:1', grids: [] });
    expect(frame.layoutGrids).toEqual([]);
  });

  it('rejects a bad nodeId, non-array grids, missing nodes, and nodes without layout grids', async () => {
    const handler = createSetLayoutGridsHandler(
      fakeFigma({ '1:1': { id: '1:1', layoutGrids: [] }, '2:2': { id: '2:2' } }),
    );
    await expect(handler({ grids: [] })).rejects.toThrow(/nodeId/);
    await expect(handler({ nodeId: '1:1', grids: 'nope' })).rejects.toThrow(/must be an array/);
    await expect(handler({ nodeId: '9:9', grids: [] })).rejects.toThrow(/not found/);
    await expect(handler({ nodeId: '2:2', grids: [] })).rejects.toThrow(/does not support/);
  });

  it('applies a grid binding, so a token gutter stays a token', async () => {
    const frame = { id: '1:1', layoutGrids: [] as unknown[] };
    const handler = createSetLayoutGridsHandler(
      fakeFigma({ '1:1': frame }, { 'V:1': { id: 'V:1', name: 'token', resolvedType: 'FLOAT' } }),
    );
    await handler({
      nodeId: '1:1',
      grids: [
        {
          pattern: 'COLUMNS',
          visible: true,
          count: 12,
          gutterSize: 24,
          alignment: 'STRETCH',
          boundVariables: { gutterSize: 'V:1' },
        },
      ],
    });
    expect(frame.layoutGrids).toEqual([
      expect.objectContaining({
        boundVariables: { gutterSize: { type: 'VARIABLE_ALIAS', id: 'V:1' } },
      }),
    ]);
  });

  // Figma refuses a colour without alpha or outside 0–1 — and the whole write with it. The colour is
  // only how the editor draws the overlay, so it alone is left out and named; the grids still land,
  // as they did before colours were read at all.
  it('leaves out a colour Figma would refuse, names it, and writes every grid', async () => {
    const frame = { id: '1:1', layoutGrids: [] as unknown[] };
    const result = (await createSetLayoutGridsHandler(fakeFigma({ '1:1': frame }))({
      nodeId: '1:1',
      grids: [
        { pattern: 'GRID', visible: true, sectionSize: 8, color: { r: 255, g: 0, b: 0, a: 0.1 } },
        { pattern: 'GRID', visible: true, sectionSize: 4, color: { r: 0, g: 0, b: 1 } },
        { pattern: 'GRID', visible: true, sectionSize: 2, color: { r: 0, g: 1, b: 0, a: 0.5 } },
        { pattern: 'GRID', visible: true, sectionSize: 1, color: 'red' },
      ],
    })) as { ok: true; nodeId: string; adjusted?: string };
    expect(frame.layoutGrids).toEqual([
      { pattern: 'GRID', visible: true, sectionSize: 8 },
      { pattern: 'GRID', visible: true, sectionSize: 4 },
      { pattern: 'GRID', visible: true, sectionSize: 2, color: { r: 0, g: 1, b: 0, a: 0.5 } },
      { pattern: 'GRID', visible: true, sectionSize: 1 },
    ]);
    expect(result.adjusted).toBe(
      "grids[0].color was not written (r must be a number from 0 to 1), so that grid has Figma's " +
        "default red at 10%; grids[1].color was not written (it has no a), so that grid has Figma's " +
        'default red at 10%; grids[3].color was not written (it has no r / g / b / a), so that grid ' +
        "has Figma's default red at 10%",
    );
  });

  it('reports nothing when every colour lands', async () => {
    const frame = { id: '1:1', layoutGrids: [] as unknown[] };
    const result = await createSetLayoutGridsHandler(fakeFigma({ '1:1': frame }))({
      nodeId: '1:1',
      grids: [
        { pattern: 'GRID', visible: true, sectionSize: 8, color: { r: 0, g: 0, b: 0, a: 0 } },
      ],
    });
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  // `space` means on a grid colour what it means on a paint: an sRGB colour from code is converted
  // into a Display P3 document's channels by Figma, and only the channels are kept.
  it("converts a colour that names another space into the document's channels", async () => {
    const frame = { id: '1:1', layoutGrids: [] as unknown[] };
    const converted: unknown[] = [];
    const figmaCtx = {
      ...fakeFigma({ '1:1': frame }),
      root: { documentColorProfile: 'DISPLAY_P3' },
      util: {
        rgb: (c: { space: string; r: number; g: number; b: number }) => {
          converted.push(c);
          return { r: 0.1, g: 0.2, b: 0.3, sourceColor: c };
        },
      },
    } as unknown as typeof figma;
    const result = await createSetLayoutGridsHandler(figmaCtx)({
      nodeId: '1:1',
      grids: [
        {
          pattern: 'GRID',
          visible: true,
          sectionSize: 8,
          color: { r: 0, g: 0.5, b: 1, a: 0.3, space: 'SRGB' },
        },
        {
          pattern: 'GRID',
          visible: true,
          sectionSize: 4,
          color: { r: 0, g: 0.5, b: 1, a: 0.3, space: 'DISPLAY_P3' },
        },
        {
          pattern: 'GRID',
          visible: true,
          sectionSize: 2,
          color: { r: 0, g: 0.5, b: 1, a: 0.3, space: 'CMYK' },
        },
      ],
    });
    expect(converted).toEqual([{ space: 'SRGB', r: 0, g: 0.5, b: 1 }]);
    expect(frame.layoutGrids).toEqual([
      { pattern: 'GRID', visible: true, sectionSize: 8, color: { r: 0.1, g: 0.2, b: 0.3, a: 0.3 } },
      { pattern: 'GRID', visible: true, sectionSize: 4, color: { r: 0, g: 0.5, b: 1, a: 0.3 } },
      { pattern: 'GRID', visible: true, sectionSize: 2 },
    ]);
    expect(result).toMatchObject({
      adjusted: expect.stringContaining(
        'grids[2].color was not written (space must be one of SRGB / DISPLAY_P3)',
      ) as unknown,
    });
  });
});
