import type { GetVariableDefsResult } from '@figma-mcp-relay/shared';
import { describe, expect, it } from 'vitest';

import { createGetVariableDefsHandler } from '../../src/handlers/get-variable-defs.js';

const fakeFigma = (collections: unknown[], variables: unknown[]): typeof figma =>
  ({
    variables: {
      getLocalVariableCollectionsAsync: async () => collections,
      getLocalVariablesAsync: async () => variables,
    },
  }) as unknown as typeof figma;

describe('get_variable_defs handler', () => {
  it('serializes collections (modes + variableIds) and variables (valuesByMode)', async () => {
    const handler = createGetVariableDefsHandler(
      fakeFigma(
        [
          {
            id: 'VC:1',
            name: 'Theme',
            key: 'ck',
            defaultModeId: 'm1',
            modes: [
              { modeId: 'm1', name: 'Light' },
              { modeId: 'm2', name: 'Dark' },
            ],
            variableIds: ['V:1', 'V:2'],
          },
        ],
        [
          {
            id: 'V:1',
            name: 'color/bg',
            key: 'vk1',
            resolvedType: 'COLOR',
            variableCollectionId: 'VC:1',
            valuesByMode: {
              m1: { r: 1, g: 1, b: 1, a: 1 },
              m2: { r: 0, g: 0, b: 0 },
            },
          },
          {
            id: 'V:2',
            name: 'color/fg',
            key: 'vk2',
            resolvedType: 'COLOR',
            variableCollectionId: 'VC:1',
            valuesByMode: { m1: { type: 'VARIABLE_ALIAS', id: 'V:1' } },
          },
        ],
      ),
    );
    const result = (await handler(undefined)) as GetVariableDefsResult;

    expect(result.collections[0]).toMatchObject({
      id: 'VC:1',
      defaultModeId: 'm1',
      variableIds: ['V:1', 'V:2'],
    });
    expect(result.collections[0]?.modes).toHaveLength(2);
    // RGB (no alpha) is normalised to a=1
    expect(result.variables[0]?.valuesByMode.m2).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(result.variables[0]?.valuesByMode.m1).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    // alias passthrough
    expect(result.variables[1]?.valuesByMode.m1).toEqual({ type: 'VARIABLE_ALIAS', id: 'V:1' });
  });

  it('passes primitive values through unchanged', async () => {
    const handler = createGetVariableDefsHandler(
      fakeFigma(
        [],
        [
          {
            id: 'V:3',
            name: 'spacing/md',
            key: 'vk3',
            resolvedType: 'FLOAT',
            variableCollectionId: 'VC:1',
            valuesByMode: { m1: 16, m2: 'auto', m3: true },
          },
        ],
      ),
    );
    const result = (await handler(undefined)) as GetVariableDefsResult;
    expect(result.variables[0]?.valuesByMode).toEqual({ m1: 16, m2: 'auto', m3: true });
  });
});
