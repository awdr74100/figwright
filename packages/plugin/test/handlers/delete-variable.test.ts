import type { VariableResult } from '@figma-mcp-relay/shared';
import { describe, expect, it, vi } from 'vitest';

import { createDeleteVariableHandler } from '../../src/handlers/delete-variable.js';

describe('delete_variable handler', () => {
  it('removes the variable and returns its captured id + name', async () => {
    const remove = vi.fn<() => void>();
    const variable = { id: 'V:0', name: 'color/primary', remove };
    const handler = createDeleteVariableHandler({
      variables: { getVariableByIdAsync: async () => variable },
    } as unknown as typeof figma);
    const result = (await handler({ variableId: 'V:0' })) as VariableResult;

    expect(remove).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: true, variableId: 'V:0', name: 'color/primary' });
  });

  it('throws when missing or input bad', async () => {
    const f = { variables: { getVariableByIdAsync: async () => null } } as unknown as typeof figma;
    await expect(createDeleteVariableHandler(f)({ variableId: 'V:9' })).rejects.toThrow(
      /not found/,
    );
    await expect(createDeleteVariableHandler(f)({})).rejects.toThrow(/variableId/);
  });
});
