import type { GetVariableDefsResult } from '@figma-mcp-relay/shared';
import { describe, expect, it } from 'vitest';

import { resolveFigmaTokens } from '../../src/tokens/figma-tokens.js';

const defs = (over: Partial<GetVariableDefsResult> = {}): GetVariableDefsResult => ({
  collections: [
    {
      id: 'col1',
      name: 'Tokens',
      key: 'k',
      defaultModeId: 'm1',
      modes: [{ modeId: 'm1', name: 'Default' }],
      variableIds: [],
    },
  ],
  variables: [],
  ...over,
});

describe('resolveFigmaTokens', () => {
  it('renders COLOR variables as hex from the default mode', () => {
    const result = resolveFigmaTokens(
      defs({
        variables: [
          {
            id: 'v1',
            name: 'Primary/500',
            key: 'k',
            resolvedType: 'COLOR',
            collectionId: 'col1',
            valuesByMode: { m1: { r: 0.384, g: 0.4, b: 0.941, a: 1 } },
          },
        ],
      }),
    );
    expect(result[0]).toMatchObject({ name: 'Primary/500', type: 'COLOR' });
    expect(result[0]?.value).toBe('#6266F0');
  });

  it('keeps FLOAT / STRING / BOOLEAN values as-is', () => {
    const result = resolveFigmaTokens(
      defs({
        variables: [
          {
            id: 'f',
            name: 'spacing/2',
            key: 'k',
            resolvedType: 'FLOAT',
            collectionId: 'col1',
            valuesByMode: { m1: 8 },
          },
          {
            id: 's',
            name: 'font/family',
            key: 'k',
            resolvedType: 'STRING',
            collectionId: 'col1',
            valuesByMode: { m1: 'Inter' },
          },
        ],
      }),
    );
    expect(result.find(t => t.name === 'spacing/2')?.value).toBe(8);
    expect(result.find(t => t.name === 'font/family')?.value).toBe('Inter');
  });

  it('follows alias chains to the concrete value', () => {
    const result = resolveFigmaTokens(
      defs({
        variables: [
          {
            id: 'base',
            name: 'palette/indigo',
            key: 'k',
            resolvedType: 'COLOR',
            collectionId: 'col1',
            valuesByMode: { m1: { r: 0.384, g: 0.4, b: 0.941, a: 1 } },
          },
          {
            id: 'alias',
            name: 'Primary/500',
            key: 'k',
            resolvedType: 'COLOR',
            collectionId: 'col1',
            valuesByMode: { m1: { type: 'VARIABLE_ALIAS', id: 'base' } },
          },
        ],
      }),
    );
    expect(result.find(t => t.name === 'Primary/500')?.value).toBe('#6266F0');
  });

  it('returns null on an alias cycle instead of looping', () => {
    const result = resolveFigmaTokens(
      defs({
        variables: [
          {
            id: 'a',
            name: 'A',
            key: 'k',
            resolvedType: 'COLOR',
            collectionId: 'col1',
            valuesByMode: { m1: { type: 'VARIABLE_ALIAS', id: 'b' } },
          },
          {
            id: 'b',
            name: 'B',
            key: 'k',
            resolvedType: 'COLOR',
            collectionId: 'col1',
            valuesByMode: { m1: { type: 'VARIABLE_ALIAS', id: 'a' } },
          },
        ],
      }),
    );
    expect(result.every(t => t.value === null)).toBe(true);
  });
});
