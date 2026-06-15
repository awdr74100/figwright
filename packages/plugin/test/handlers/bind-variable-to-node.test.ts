import type { MutateResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createBindVariableToNodeHandler } from '../../src/handlers/bind-variable-to-node.js';

const fakeFigma = (node: unknown, variable: unknown): typeof figma =>
  ({
    getNodeByIdAsync: async () => node,
    variables: { getVariableByIdAsync: async () => variable },
  }) as unknown as typeof figma;

describe('bind_variable_to_node handler', () => {
  it('binds the variable to the node field', async () => {
    const setBoundVariable = vi.fn<() => void>();
    const node = { id: '1:1', setBoundVariable };
    const variable = { id: 'V:0' };
    const handler = createBindVariableToNodeHandler(fakeFigma(node, variable));
    const result = (await handler({
      nodeId: '1:1',
      field: 'width',
      variableId: 'V:0',
    })) as MutateResult;

    expect(setBoundVariable).toHaveBeenCalledWith('width', variable);
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it('unbinds the field when variableId is null (without looking up a variable)', async () => {
    const setBoundVariable = vi.fn<() => void>();
    const getVariableByIdAsync = vi.fn<() => Promise<{ id: string }>>(async () => ({ id: 'V:0' }));
    const node = { id: '1:1', setBoundVariable };
    const handler = createBindVariableToNodeHandler({
      getNodeByIdAsync: async () => node,
      variables: { getVariableByIdAsync },
    } as unknown as typeof figma);
    const result = (await handler({
      nodeId: '1:1',
      field: 'width',
      variableId: null,
    })) as MutateResult;

    expect(setBoundVariable).toHaveBeenCalledWith('width', null);
    expect(getVariableByIdAsync).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it('redirects fills/strokes to bind_variable_to_paint (paint-level colour binding)', async () => {
    for (const field of ['fills', 'strokes']) {
      await expect(
        createBindVariableToNodeHandler(
          fakeFigma({ id: '1:1', setBoundVariable() {} }, { id: 'V:0' }),
        )({ nodeId: '1:1', field, variableId: 'V:0' }),
      ).rejects.toThrow(/use bind_variable_to_paint instead/);
    }
  });

  it('throws on missing node, missing variable, or non-bindable node', async () => {
    await expect(
      createBindVariableToNodeHandler(fakeFigma(null, { id: 'V:0' }))({
        nodeId: '9:9',
        field: 'width',
        variableId: 'V:0',
      }),
    ).rejects.toThrow(/node .* not found/);
    await expect(
      createBindVariableToNodeHandler(fakeFigma({ id: '1:1', setBoundVariable() {} }, null))({
        nodeId: '1:1',
        field: 'width',
        variableId: 'V:9',
      }),
    ).rejects.toThrow(/variable .* not found/);
    await expect(
      createBindVariableToNodeHandler(fakeFigma({ id: '1:1' }, { id: 'V:0' }))({
        nodeId: '1:1',
        field: 'width',
        variableId: 'V:0',
      }),
    ).rejects.toThrow(/cannot bind/);
  });
});
