import type { MutateResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createBindVariableToPaintHandler } from '../../src/handlers/bind-variable-to-paint.js';

const solid = () => ({ type: 'SOLID', color: { r: 1, g: 1, b: 1 } });

// setBoundVariableForPaint returns a NEW paint (the binding marker) — the handler must write it back.
const fakeFigma = (node: unknown, variable: unknown, bound: unknown) =>
  ({
    getNodeByIdAsync: async () => node,
    variables: {
      getVariableByIdAsync: async () => variable,
      setBoundVariableForPaint: vi.fn<() => unknown>(() => bound),
    },
  }) as unknown as typeof figma & {
    variables: { setBoundVariableForPaint: ReturnType<typeof vi.fn> };
  };

describe('bind_variable_to_paint handler', () => {
  it('binds a colour variable to fills[0] and writes back a new paint array', async () => {
    const node = { id: '1:1', fills: [solid()] };
    const variable = { id: 'V:white' };
    const boundPaint = {
      type: 'SOLID',
      color: { r: 1, g: 1, b: 1 },
      boundVariables: { color: variable },
    };
    const ctx = fakeFigma(node, variable, boundPaint);

    const result = (await createBindVariableToPaintHandler(ctx)({
      nodeId: '1:1',
      variableId: 'V:white',
    })) as MutateResult;

    expect(ctx.variables.setBoundVariableForPaint).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SOLID' }),
      'color',
      variable,
    );
    // a NEW array with the returned paint at the index (not a mutation of the read-only original)
    expect(node.fills).toEqual([boundPaint]);
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it('targets strokes and the given index', async () => {
    const node = { id: '2:2', strokes: [solid(), solid()] };
    const variable = { id: 'V:grey' };
    const bound = { type: 'SOLID', color: { r: 0, g: 0, b: 0 } };
    const ctx = fakeFigma(node, variable, bound);

    await createBindVariableToPaintHandler(ctx)({
      nodeId: '2:2',
      target: 'strokes',
      index: 1,
      variableId: 'V:grey',
    });

    expect(node.strokes[1]).toBe(bound);
    expect(node.strokes[0]).toEqual(solid()); // untouched
  });

  it('unbinds with variableId null, never looking up a variable', async () => {
    const getVariableByIdAsync = vi.fn<() => Promise<unknown>>();
    const node = { id: '3:3', fills: [solid()] };
    const bound = solid();
    const ctx = {
      getNodeByIdAsync: async () => node,
      variables: {
        getVariableByIdAsync,
        setBoundVariableForPaint: vi.fn<() => unknown>(() => bound),
      },
    } as unknown as typeof figma;

    const result = (await createBindVariableToPaintHandler(ctx)({
      nodeId: '3:3',
      variableId: null,
    })) as MutateResult;

    expect(getVariableByIdAsync).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, nodeId: '3:3' });
  });

  it('rejects a non-SOLID paint at the target index', async () => {
    const node = { id: '4:4', fills: [{ type: 'GRADIENT_LINEAR' }] };
    await expect(
      createBindVariableToPaintHandler(fakeFigma(node, { id: 'V:0' }, {}))({
        nodeId: '4:4',
        variableId: 'V:0',
      }),
    ).rejects.toThrow(/only SOLID paints/);
  });

  it('throws on missing node, missing paint index, or missing variable', async () => {
    await expect(
      createBindVariableToPaintHandler(fakeFigma(null, { id: 'V:0' }, {}))({
        nodeId: '9:9',
        variableId: 'V:0',
      }),
    ).rejects.toThrow(/not found or has no fills/);

    await expect(
      createBindVariableToPaintHandler(fakeFigma({ id: '1:1', fills: [] }, { id: 'V:0' }, {}))({
        nodeId: '1:1',
        index: 0,
        variableId: 'V:0',
      }),
    ).rejects.toThrow(/no paint at fills\[0\]/);

    await expect(
      createBindVariableToPaintHandler(fakeFigma({ id: '1:1', fills: [solid()] }, null, {}))({
        nodeId: '1:1',
        variableId: 'V:missing',
      }),
    ).rejects.toThrow(/variable .* not found/);
  });
});
