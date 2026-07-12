import type { GetStylesResult, GetVariableDefsResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { resolveFigmaTokens, resolvePaintStyleTokens } from '../../src/tokens/figma-tokens.js';

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
    expect(result[0]?.collection).toBe('Tokens'); // collection name carried through for the join
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

  it('carries per-mode values keyed by mode name when a multi-mode value differs', () => {
    const result = resolveFigmaTokens(
      defs({
        collections: [
          {
            id: 'theme',
            name: 'Theme',
            key: 'k',
            defaultModeId: 'light',
            modes: [
              { modeId: 'light', name: 'Light' },
              { modeId: 'dark', name: 'Dark' },
            ],
            variableIds: [],
          },
        ],
        variables: [
          {
            id: 'bg',
            name: 'bg/surface',
            key: 'k',
            resolvedType: 'COLOR',
            collectionId: 'theme',
            valuesByMode: {
              light: { r: 1, g: 1, b: 1, a: 1 },
              dark: { r: 0.039, g: 0.039, b: 0.039, a: 1 },
            },
          },
        ],
      }),
    );
    // value stays the default mode (Light) — the join's matching input is unchanged.
    expect(result[0]?.value).toBe('#FFFFFF');
    expect(result[0]?.modes).toEqual({ Light: '#FFFFFF', Dark: '#0A0A0A' });
  });

  it('omits modes when every mode resolves to the same value (not theme-dependent)', () => {
    const result = resolveFigmaTokens(
      defs({
        collections: [
          {
            id: 'theme',
            name: 'Theme',
            key: 'k',
            defaultModeId: 'light',
            modes: [
              { modeId: 'light', name: 'Light' },
              { modeId: 'dark', name: 'Dark' },
            ],
            variableIds: [],
          },
        ],
        variables: [
          {
            id: 'brand',
            name: 'brand/primary',
            key: 'k',
            resolvedType: 'COLOR',
            collectionId: 'theme',
            valuesByMode: {
              light: { r: 0.384, g: 0.4, b: 0.941, a: 1 },
              dark: { r: 0.384, g: 0.4, b: 0.941, a: 1 },
            },
          },
        ],
      }),
    );
    expect(result[0]?.value).toBe('#6266F0');
    expect(result[0]?.modes).toBeUndefined();
  });

  it('resolves per-mode aliases into a single-mode primitive collection', () => {
    // The common semantic → primitive split: the themed collection aliases a different primitive
    // per mode; the primitives themselves are single-mode.
    const result = resolveFigmaTokens(
      defs({
        collections: [
          {
            id: 'theme',
            name: 'Theme',
            key: 'k',
            defaultModeId: 'light',
            modes: [
              { modeId: 'light', name: 'Light' },
              { modeId: 'dark', name: 'Dark' },
            ],
            variableIds: [],
          },
          {
            id: 'prim',
            name: 'Primitives',
            key: 'k',
            defaultModeId: 'p1',
            modes: [{ modeId: 'p1', name: 'Value' }],
            variableIds: [],
          },
        ],
        variables: [
          {
            id: 'bg',
            name: 'bg/surface',
            key: 'k',
            resolvedType: 'COLOR',
            collectionId: 'theme',
            valuesByMode: {
              light: { type: 'VARIABLE_ALIAS', id: 'gray50' },
              dark: { type: 'VARIABLE_ALIAS', id: 'gray900' },
            },
          },
          {
            id: 'gray50',
            name: 'gray/50',
            key: 'k',
            resolvedType: 'COLOR',
            collectionId: 'prim',
            valuesByMode: { p1: { r: 0.98, g: 0.98, b: 0.98, a: 1 } },
          },
          {
            id: 'gray900',
            name: 'gray/900',
            key: 'k',
            resolvedType: 'COLOR',
            collectionId: 'prim',
            valuesByMode: { p1: { r: 0.066, g: 0.094, b: 0.153, a: 1 } },
          },
        ],
      }),
    );
    const surface = result.find(t => t.name === 'bg/surface');
    expect(surface?.value).toBe('#FAFAFA'); // default mode (Light) → gray/50
    expect(surface?.modes).toEqual({ Light: '#FAFAFA', Dark: '#111827' });
  });

  it('chases the same-named mode across multi-mode collections', () => {
    // An alias into another multi-mode collection follows the mode NAME (Light chases Light), even
    // when the target collection's default is the other mode — that's how paired theme collections
    // are meant to switch together. The plain default-mode `value` keeps Figma's own default
    // resolution (each collection at its default), unchanged from before.
    const result = resolveFigmaTokens(
      defs({
        collections: [
          {
            id: 'theme',
            name: 'Theme',
            key: 'k',
            defaultModeId: 'light',
            modes: [
              { modeId: 'light', name: 'Light' },
              { modeId: 'dark', name: 'Dark' },
            ],
            variableIds: [],
          },
          {
            id: 'pal',
            name: 'Palette',
            key: 'k',
            defaultModeId: 'pdark',
            modes: [
              { modeId: 'pdark', name: 'Dark' },
              { modeId: 'plight', name: 'Light' },
            ],
            variableIds: [],
          },
        ],
        variables: [
          {
            id: 'bg',
            name: 'bg/surface',
            key: 'k',
            resolvedType: 'COLOR',
            collectionId: 'theme',
            valuesByMode: {
              light: { type: 'VARIABLE_ALIAS', id: 'base' },
              dark: { type: 'VARIABLE_ALIAS', id: 'base' },
            },
          },
          {
            id: 'base',
            name: 'base/surface',
            key: 'k',
            resolvedType: 'COLOR',
            collectionId: 'pal',
            valuesByMode: {
              plight: { r: 1, g: 1, b: 1, a: 1 },
              pdark: { r: 0.039, g: 0.039, b: 0.039, a: 1 },
            },
          },
        ],
      }),
    );
    const surface = result.find(t => t.name === 'bg/surface');
    expect(surface?.modes).toEqual({ Light: '#FFFFFF', Dark: '#0A0A0A' });
    // Default read resolves each hop at its own collection's default (Palette's is Dark).
    expect(surface?.value).toBe('#0A0A0A');
  });

  it('omits modes (and does not loop) when a multi-mode alias cycles', () => {
    const result = resolveFigmaTokens(
      defs({
        collections: [
          {
            id: 'theme',
            name: 'Theme',
            key: 'k',
            defaultModeId: 'light',
            modes: [
              { modeId: 'light', name: 'Light' },
              { modeId: 'dark', name: 'Dark' },
            ],
            variableIds: [],
          },
        ],
        variables: [
          {
            id: 'a',
            name: 'A',
            key: 'k',
            resolvedType: 'COLOR',
            collectionId: 'theme',
            valuesByMode: {
              light: { type: 'VARIABLE_ALIAS', id: 'b' },
              dark: { type: 'VARIABLE_ALIAS', id: 'b' },
            },
          },
          {
            id: 'b',
            name: 'B',
            key: 'k',
            resolvedType: 'COLOR',
            collectionId: 'theme',
            valuesByMode: {
              light: { type: 'VARIABLE_ALIAS', id: 'a' },
              dark: { type: 'VARIABLE_ALIAS', id: 'a' },
            },
          },
        ],
      }),
    );
    expect(result.every(t => t.value === null)).toBe(true);
    expect(result.every(t => t.modes === undefined)).toBe(true); // null everywhere = not themed
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

describe('resolvePaintStyleTokens', () => {
  const paint = (
    name: string,
    paints: GetStylesResult['paints'][number]['paints'],
  ): GetStylesResult['paints'][number] => ({
    id: `S:${name}`,
    name,
    key: 'k',
    description: '',
    paints,
  });

  const solid = (r: number, g: number, b: number, over: Record<string, unknown> = {}) => ({
    type: 'SOLID' as const,
    visible: true,
    opacity: 1,
    color: { r, g, b },
    ...over,
  });

  it('converts a single visible SOLID paint style into a COLOR pseudo-token marked style', () => {
    const [t] = resolvePaintStyleTokens([paint('Primary/500', [solid(0.384, 0.4, 0.941)])]);
    expect(t).toEqual({ name: 'Primary/500', value: '#6266F0', type: 'COLOR', source: 'style' });
  });

  it('folds a semi-transparent solid into an 8-digit hex', () => {
    const [t] = resolvePaintStyleTokens([paint('Overlay', [solid(0, 0, 0, { opacity: 0.25 })])]);
    expect(t?.value).toBe('#00000040');
  });

  it('skips gradient, image, multi-paint, and invisible-only styles', () => {
    const gradient = {
      type: 'GRADIENT_LINEAR' as const,
      visible: true,
      opacity: 1,
      gradientStops: [],
      gradientTransform: [
        [1, 0, 0],
        [0, 1, 0],
      ],
    };
    const tokens = resolvePaintStyleTokens([
      paint('Hero/Gradient', [gradient]),
      paint('Card/Layered', [solid(1, 1, 1), solid(0, 0, 0)]),
      paint('Hidden', [solid(1, 0, 0, { visible: false })]),
    ]);
    expect(tokens).toEqual([]);
  });

  it('ignores an invisible extra paint when exactly one visible SOLID remains', () => {
    const tokens = resolvePaintStyleTokens([
      paint('Brand/Red', [solid(0.5, 0, 0, { visible: false }), solid(0.902, 0.141, 0.165)]),
    ]);
    expect(tokens[0]?.name).toBe('Brand/Red');
    expect(tokens[0]?.value).toBe('#E6242A');
  });
});
