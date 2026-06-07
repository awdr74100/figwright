import type { VariableResult } from '@figma-mcp-relay/shared';
import { describe, expect, it } from 'vitest';

import { createRenameVariableHandler } from '../../src/handlers/rename-variable.js';

const fakeFigma = (variable: unknown): typeof figma =>
  ({
    variables: { getVariableByIdAsync: async () => variable },
  }) as unknown as typeof figma;

describe('rename_variable handler', () => {
  it('renames the variable', async () => {
    const variable = { id: 'V:0', name: 'color/primary' };
    const result = (await createRenameVariableHandler(fakeFigma(variable))({
      variableId: 'V:0',
      name: 'color/brand',
    })) as VariableResult;

    expect(variable.name).toBe('color/brand');
    expect(result).toEqual({ ok: true, variableId: 'V:0', name: 'color/brand' });
  });

  it('throws on missing variable or bad input', async () => {
    await expect(
      createRenameVariableHandler(fakeFigma(null))({ variableId: 'V:9', name: 'x' }),
    ).rejects.toThrow(/not found/);
    await expect(
      createRenameVariableHandler(fakeFigma({ id: 'V:0', name: 'a' }))({
        variableId: 'V:0',
        name: '',
      }),
    ).rejects.toThrow(/name/);
    await expect(
      createRenameVariableHandler(fakeFigma({ id: 'V:0', name: 'a' }))({ name: 'x' }),
    ).rejects.toThrow(/variableId/);
  });
});
