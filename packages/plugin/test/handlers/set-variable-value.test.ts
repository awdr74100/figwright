import type { VariableResult } from '@figma-mcp-relay/shared';
import { describe, expect, it, vi } from 'vitest';

import { createSetVariableValueHandler } from '../../src/handlers/set-variable-value.js';

const fakeFigma = (variable: unknown): typeof figma =>
  ({ variables: { getVariableByIdAsync: async () => variable } }) as unknown as typeof figma;

describe('set_variable_value handler', () => {
  it('sets a color value for a mode (RGB normalised to RGBA pass-through)', async () => {
    const setValueForMode = vi.fn<() => void>();
    const variable = { id: 'V:0', name: 'color/primary', setValueForMode };
    const handler = createSetVariableValueHandler(fakeFigma(variable));
    const result = (await handler({
      variableId: 'V:0',
      modeId: 'M:0',
      value: { r: 1, g: 0, b: 0, a: 1 },
    })) as VariableResult;

    expect(setValueForMode).toHaveBeenCalledWith('M:0', { r: 1, g: 0, b: 0, a: 1 });
    expect(result).toEqual({ ok: true, variableId: 'V:0', name: 'color/primary' });
  });

  it('converts a VARIABLE_ALIAS value', async () => {
    const setValueForMode = vi.fn<() => void>();
    const variable = { id: 'V:0', name: 'x', setValueForMode };
    const handler = createSetVariableValueHandler(fakeFigma(variable));
    await handler({ variableId: 'V:0', modeId: 'M:0', value: { type: 'VARIABLE_ALIAS', id: 'V:9' } });
    expect(setValueForMode).toHaveBeenCalledWith('M:0', { type: 'VARIABLE_ALIAS', id: 'V:9' });
  });

  it('throws when variable missing or input bad', async () => {
    await expect(
      createSetVariableValueHandler(fakeFigma(null))({ variableId: 'V:9', modeId: 'M:0', value: 1 }),
    ).rejects.toThrow(/not found/);
    await expect(
      createSetVariableValueHandler(fakeFigma(null))({ variableId: 'V:0', modeId: 'M:0' }),
    ).rejects.toThrow(/value is required/);
  });
});
