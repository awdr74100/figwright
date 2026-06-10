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
    await handler({
      variableId: 'V:0',
      modeId: 'M:0',
      value: { type: 'VARIABLE_ALIAS', id: 'V:9' },
    });
    expect(setValueForMode).toHaveBeenCalledWith('M:0', { type: 'VARIABLE_ALIAS', id: 'V:9' });
  });

  // Some MCP clients stringify the schema-untyped `value` in transit; the handler realigns it to the
  // variable's resolvedType so Figma's setValueForMode does not reject every non-STRING variable.
  it('coerces a stringified value back to the variable resolvedType', async () => {
    const cases: { resolvedType: string; raw: unknown; expected: unknown }[] = [
      { resolvedType: 'FLOAT', raw: '42', expected: 42 },
      { resolvedType: 'BOOLEAN', raw: 'true', expected: true },
      { resolvedType: 'BOOLEAN', raw: 'false', expected: false },
      {
        resolvedType: 'COLOR',
        raw: '{"r":0.2,"g":0.5,"b":1,"a":1}',
        expected: { r: 0.2, g: 0.5, b: 1, a: 1 },
      },
      { resolvedType: 'STRING', raw: 'hello', expected: 'hello' },
    ];
    for (const { resolvedType, raw, expected } of cases) {
      const setValueForMode = vi.fn<() => void>();
      const handler = createSetVariableValueHandler(
        fakeFigma({ id: 'V:0', name: 'x', resolvedType, setValueForMode }),
      );
      // eslint-disable-next-line no-await-in-loop -- small fixed table, sequential is fine
      await handler({ variableId: 'V:0', modeId: 'M:0', value: raw });
      expect(setValueForMode).toHaveBeenCalledWith('M:0', expected);
    }
  });

  // Regression for the go-style bug where a FLOAT "parser" strips alias objects: our coerce only
  // touches strings, so an alias to a FLOAT variable must pass through untouched (not NaN'd/stripped).
  it('passes a VARIABLE_ALIAS through for a FLOAT variable (not coerced to a number)', async () => {
    const setValueForMode = vi.fn<() => void>();
    const handler = createSetVariableValueHandler(
      fakeFigma({ id: 'V:0', name: 'radius/md', resolvedType: 'FLOAT', setValueForMode }),
    );
    await handler({
      variableId: 'V:0',
      modeId: 'M:0',
      value: { type: 'VARIABLE_ALIAS', id: 'V:9' },
    });
    expect(setValueForMode).toHaveBeenCalledWith('M:0', { type: 'VARIABLE_ALIAS', id: 'V:9' });
  });

  // The same go#22 alias, but stringified in transit (the client that stringifies COLOR's RGBA does
  // it to alias objects too). The FLOAT branch must JSON.parse it back rather than Number()→NaN it.
  it('parses a stringified VARIABLE_ALIAS back for a FLOAT variable', async () => {
    const setValueForMode = vi.fn<() => void>();
    const handler = createSetVariableValueHandler(
      fakeFigma({ id: 'V:0', name: 'radius/md', resolvedType: 'FLOAT', setValueForMode }),
    );
    await handler({
      variableId: 'V:0',
      modeId: 'M:0',
      value: '{"type":"VARIABLE_ALIAS","id":"V:9"}',
    });
    expect(setValueForMode).toHaveBeenCalledWith('M:0', { type: 'VARIABLE_ALIAS', id: 'V:9' });
  });

  it('rejects a stringified FLOAT that is not a number', async () => {
    const variable = {
      id: 'V:0',
      name: 'x',
      resolvedType: 'FLOAT',
      setValueForMode: vi.fn<() => void>(),
    };
    await expect(
      createSetVariableValueHandler(fakeFigma(variable))({
        variableId: 'V:0',
        modeId: 'M:0',
        value: 'abc',
      }),
    ).rejects.toThrow(/not a number/);
  });

  it('throws when variable missing or input bad', async () => {
    await expect(
      createSetVariableValueHandler(fakeFigma(null))({
        variableId: 'V:9',
        modeId: 'M:0',
        value: 1,
      }),
    ).rejects.toThrow(/not found/);
    await expect(
      createSetVariableValueHandler(fakeFigma(null))({ variableId: 'V:0', modeId: 'M:0' }),
    ).rejects.toThrow(/value is required/);
  });
});
