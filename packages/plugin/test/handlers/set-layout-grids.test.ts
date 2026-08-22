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
});
