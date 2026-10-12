import { describe, expect, it } from 'vitest';

import {
  ResponsiveLayoutConfigSchema,
  resolveResponsiveLayoutConfig,
  evaluateResponsiveRoot,
} from '../src/responsive-layout.js';

const fixture = () => ({
  version: 1,
  pageId: 'p',
  roots: [
    {
      rootId: 'r',
      base: [{ type: 'visibility', nodeId: 'i', values: { visible: true } }],
      breakpoints: [
        { at: 'base', overrides: [] },
        { at: 'md', overrides: [{ type: 'visibility', nodeId: 'i', values: { visible: false } }] },
        { at: 'lg', overrides: [] },
      ],
    },
  ],
});
const resolve = (input: unknown) =>
  resolveResponsiveLayoutConfig(ResponsiveLayoutConfigSchema.parse(input));

describe('responsive rules', () => {
  it.each([
    [0, 0],
    [640, 0],
    [768, 640],
    [1024, 768],
    [1280, 1024],
    [1536, 1280],
  ])('selects standard threshold %s inclusively', (width, below) => {
    const c = fixture();
    c.roots[0]!.breakpoints = ['base', 'sm', 'md', 'lg', 'xl', '2xl'].map(at => ({
      at,
      overrides: [],
    }));
    const resolved = resolve(c);
    expect(resolved.breakpointPreset).toBe('standard');
    const explicit = resolve({ ...c, breakpointPreset: 'standard' });
    expect(explicit.breakpointPreset).toBe('standard');
    expect(explicit.roots).toEqual(resolved.roots);
    const root = resolved.roots[0]!;
    expect(evaluateResponsiveRoot(root, width).minWidth).toBe(width);
    expect(evaluateResponsiveRoot(root, Math.max(0, width - 0.5)).minWidth).toBe(below);
  });
  it('restores base instead of accumulating previous overrides', () => {
    const root = resolve(fixture()).roots[0]!;
    expect(evaluateResponsiveRoot(root, 767).actions[0]!.values).toEqual({ visible: true });
    expect(evaluateResponsiveRoot(root, 768).actions[0]!.values).toEqual({ visible: false });
    expect(evaluateResponsiveRoot(root, 1024).actions[0]!.values).toEqual({ visible: true });
  });
  it('resolves root overrides ahead of config overrides and records their sources', () => {
    const c = fixture();
    const resolved = resolve({
      ...c,
      breakpointValues: { md: 820 },
      roots: [
        c.roots[0],
        {
          ...c.roots[0],
          rootId: 'r2',
          base: [{ type: 'visibility', nodeId: 'i2', values: { visible: true } }],
          breakpoints: [
            { at: 'base', overrides: [] },
            { at: 'md', overrides: [] },
          ],
          breakpointValues: { md: 800 },
        },
      ],
    });
    expect(resolved.roots[0]!.breakpoints[1]).toMatchObject({ minWidth: 820, source: 'config' });
    expect(resolved.roots[1]!.breakpoints[1]).toMatchObject({ minWidth: 800, source: 'root' });
    expect(resolved.roots[0]!.breakpoints).toHaveLength(3);
  });
  it('supports none with explicit numbers or a completely custom name table', () => {
    const c = fixture();
    const numeric = resolve({
      ...c,
      breakpointPreset: 'none',
      roots: [
        {
          ...c.roots[0],
          breakpoints: [
            { minWidth: 0, overrides: [] },
            { minWidth: 600, overrides: [] },
          ],
        },
      ],
    });
    expect(numeric.roots[0]!.breakpoints.map(b => b.minWidth)).toEqual([0, 600]);
    const named = resolve({
      ...c,
      breakpointPreset: 'none',
      breakpointValues: { small: 0, wide: 900 },
      roots: [
        {
          ...c.roots[0],
          breakpoints: [
            { at: 'small', overrides: [] },
            { at: 'wide', overrides: [] },
          ],
        },
      ],
    });
    expect(named.roots[0]!.breakpoints.map(b => b.minWidth)).toEqual([0, 900]);
  });
  it('never synthesizes unused preset actions and does not mutate inputs or evaluation outputs', () => {
    const c = fixture();
    const before = JSON.parse(JSON.stringify(c)) as typeof c;
    const root = resolve(c).roots[0]!;
    expect(evaluateResponsiveRoot(root, 640).minWidth).toBe(0);
    const first = evaluateResponsiveRoot(root, 768);
    first.actions.length = 0;
    expect(evaluateResponsiveRoot(root, 768).actions).toHaveLength(1);
    expect(c).toEqual(before);
  });
  it('treats spacing bindings as atomic while merging public properties by key', () => {
    const c = fixture();
    const root = resolve({
      ...c,
      roots: [
        {
          rootId: 'r',
          base: [
            {
              type: 'layout',
              nodeId: 'f',
              values: { itemSpacing: { value: -8, variableId: 'v' } },
            },
            { type: 'componentProperties', nodeId: 'i', values: { 'Show#1': true, Size: 'Large' } },
          ],
          breakpoints: [
            { at: 'base', overrides: [] },
            {
              at: 'md',
              overrides: [
                { type: 'layout', nodeId: 'f', values: { itemSpacing: { value: 0 } } },
                { type: 'componentProperties', nodeId: 'i', values: { Size: 'Small' } },
              ],
            },
          ],
        },
      ],
    }).roots[0]!;
    expect(evaluateResponsiveRoot(root, 768).actions.map(a => a.values)).toEqual([
      { itemSpacing: { value: 0 } },
      { 'Show#1': true, Size: 'Small' },
    ]);
  });
  it.each([
    ['unknown name', { breakpoints: [{ at: 'missing', overrides: [] }] }],
    ['duplicate width after override', { breakpointValues: { md: 1024 } }],
    ['unordered width after override', { breakpointValues: { md: 1200 } }],
    ['nonzero base', { breakpointValues: { base: 1 } }],
    ['both selectors', { breakpoints: [{ at: 'base', minWidth: 0, overrides: [] }] }],
    ['missing selector', { breakpoints: [{ overrides: [] }] }],
    ['nonzero first threshold', { breakpoints: [{ minWidth: 1, overrides: [] }] }],
    [
      'unowned target',
      {
        breakpoints: [
          {
            at: 'base',
            overrides: [{ type: 'visibility', nodeId: 'other', values: { visible: false } }],
          },
        ],
      },
    ],
    [
      'unowned field',
      {
        breakpoints: [
          { at: 'base', overrides: [{ type: 'layout', nodeId: 'i', values: { maxWidth: 500 } }] },
        ],
      },
    ],
    [
      'duplicate action',
      {
        base: [
          { type: 'visibility', nodeId: 'i', values: { visible: true } },
          { type: 'visibility', nodeId: 'i', values: { visible: false } },
        ],
      },
    ],
  ])('rejects %s before accepting rules', (_name, change) => {
    const c = fixture();
    expect(() => resolve({ ...c, roots: [{ ...c.roots[0], ...change }] })).toThrow(Error);
  });
  it.each([NaN, Infinity, -1])('rejects invalid width %s', value => {
    expect(() => evaluateResponsiveRoot(resolve(fixture()).roots[0]!, value)).toThrow(Error);
    expect(() => resolve({ ...fixture(), breakpointValues: { md: value } })).toThrow(Error);
  });
  it('rejects unknown fields, unknown versions and unsafe grid overrides', () => {
    expect(() => resolve({ ...fixture(), arbitraryScript: 'x' })).toThrow(Error);
    expect(() => resolve({ ...fixture(), version: 2 })).toThrow(Error);
    const c = fixture();
    expect(() =>
      resolve({
        ...c,
        roots: [
          {
            ...c.roots[0],
            base: [
              {
                type: 'grid',
                nodeId: 'g',
                values: { gridAutoTracks: 'ROWS', autoRowTrack: { type: 'HUG' } },
              },
            ],
            breakpoints: [
              {
                at: 'base',
                overrides: [{ type: 'grid', nodeId: 'g', values: { gridAutoTracks: 'NONE' } }],
              },
            ],
          },
        ],
      }),
    ).toThrow(Error);
  });
  it.each([
    ['roots', 33],
    ['breakpoints', 25],
    ['base', 129],
    ['overrides', 129],
    ['names', 25],
    ['columns', 25],
    ['rows', 257],
  ])('bounds %s', (kind, count) => {
    const c = fixture();
    const n = Number(count);
    let invalid: unknown;
    if (kind === 'roots')
      invalid = {
        ...c,
        roots: Array.from({ length: n }, (_, i) => ({ ...c.roots[0], rootId: `r${i}` })),
      };
    if (kind === 'breakpoints')
      invalid = {
        ...c,
        roots: [
          {
            ...c.roots[0],
            breakpoints: Array.from({ length: n }, (_, i) => ({ minWidth: i, overrides: [] })),
          },
        ],
      };
    if (kind === 'base')
      invalid = {
        ...c,
        roots: [
          {
            ...c.roots[0],
            base: Array.from({ length: n }, (_, i) => ({
              type: 'visibility',
              nodeId: `i${i}`,
              values: { visible: true },
            })),
          },
        ],
      };
    if (kind === 'overrides')
      invalid = {
        ...c,
        roots: [
          {
            ...c.roots[0],
            breakpoints: [
              { at: 'base', overrides: Array.from({ length: n }, () => c.roots[0]!.base[0]) },
            ],
          },
        ],
      };
    if (kind === 'names')
      invalid = {
        ...c,
        breakpointPreset: 'none',
        breakpointValues: Object.fromEntries(Array.from({ length: n }, (_, i) => [`n${i}`, i])),
      };
    if (kind === 'columns' || kind === 'rows')
      invalid = {
        ...c,
        roots: [
          {
            ...c.roots[0],
            base: [
              {
                type: 'grid',
                nodeId: 'g',
                values: { [kind]: Array.from({ length: n }, () => ({ type: 'HUG' })) },
              },
            ],
            breakpoints: [{ at: 'base', overrides: [] }],
          },
        ],
      };
    expect(() => resolve(invalid)).toThrow(Error);
  });
});
