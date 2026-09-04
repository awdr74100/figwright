import type { GetStylesResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createGetStylesHandler } from '../../src/handlers/get-styles.js';

const fakeFigma = (
  over: Partial<Record<string, unknown[]>> = {},
  variables?: Record<string, { name: string; resolvedType: string; codeSyntax?: unknown }>,
): typeof figma =>
  ({
    getLocalPaintStylesAsync: async () => over.paints ?? [],
    getLocalTextStylesAsync: async () => over.texts ?? [],
    getLocalEffectStylesAsync: async () => over.effects ?? [],
    getLocalGridStylesAsync: async () => over.grids ?? [],
    ...(variables === undefined
      ? {}
      : {
          variables: {
            getVariableByIdAsync: async (id: string) => variables[id] ?? null,
          },
        }),
  }) as unknown as typeof figma;

const alias = (id: string): unknown => ({ type: 'VARIABLE_ALIAS', id });

describe('get_styles handler', () => {
  it('reports no cssAngle on a paint style’s gradient', async () => {
    // A style belongs to no node, so it has no aspect ratio and the angle genuinely does not exist
    // — as opposed to being unknown. Handing one a size here would invent a number.
    const handler = createGetStylesHandler(
      fakeFigma({
        paints: [
          {
            id: 'S:9',
            name: 'Brand/Gradient',
            key: 'k9',
            description: '',
            paints: [
              {
                type: 'GRADIENT_LINEAR',
                visible: true,
                opacity: 1,
                gradientStops: [{ position: 0, color: { r: 1, g: 0, b: 0, a: 1 } }],
                gradientTransform: [
                  [0.5, 0.5, 0],
                  [0, 1, 0],
                ],
              },
            ],
          },
        ],
      }),
    );
    const out = (await handler({})) as {
      paints: { paints: { cssAngle?: number; gradientTransform?: number[][] }[] }[];
    };
    expect(out.paints[0]?.paints[0]).not.toHaveProperty('cssAngle');
    // The matrix is still there — it is what a write round-trips, and the only direction source.
    expect(out.paints[0]?.paints[0]?.gradientTransform).toEqual([
      [0.5, 0.5, 0],
      [0, 1, 0],
    ]);
  });

  it('groups the four style categories with their payloads', async () => {
    const handler = createGetStylesHandler(
      fakeFigma({
        paints: [
          {
            id: 'S:1',
            name: 'Brand/Primary',
            key: 'k1',
            description: 'primary',
            paints: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0 } }],
          },
        ],
        texts: [
          {
            id: 'S:2',
            name: 'Body',
            key: 'k2',
            description: '',
            fontName: { family: 'Inter', style: 'Regular' },
            fontSize: 16,
            lineHeight: { unit: 'PIXELS', value: 24 },
            letterSpacing: { unit: 'PERCENT', value: 0 },
            textWrapStyle: 'BALANCE',
          },
        ],
        effects: [
          {
            id: 'S:3',
            name: 'Card Shadow',
            key: 'k3',
            description: '',
            effects: [
              {
                type: 'DROP_SHADOW',
                visible: true,
                radius: 4,
                color: { r: 0, g: 0, b: 0, a: 0.2 },
                offset: { x: 0, y: 2 },
                spread: 0,
                blendMode: 'NORMAL',
              },
            ],
          },
        ],
        grids: [
          {
            id: 'S:4',
            name: '12 Col',
            key: 'k4',
            description: '',
            layoutGrids: [
              {
                pattern: 'COLUMNS',
                visible: true,
                count: 12,
                gutterSize: 20,
                alignment: 'STRETCH',
              },
            ],
          },
        ],
      }),
    );
    const result = (await handler(undefined)) as GetStylesResult;
    expect(result.paints[0]?.paints[0]).toMatchObject({
      type: 'SOLID',
      color: { r: 1, g: 0, b: 0 },
    });
    expect(result.texts[0]).toMatchObject({
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 16,
      lineHeight: { unit: 'PIXELS', value: 24 },
      // A text style carries its own wrap balancing, so "Body" can mean text-wrap: balance for
      // every node bound to it — pass it through rather than making codegen guess per node.
      textWrapStyle: 'BALANCE',
    });
    expect(result.effects[0]?.effects[0]?.type).toBe('DROP_SHADOW');
    expect(result.grids[0]?.grids[0]?.count).toBe(12);
  });

  it('serializes AUTO line height without a value', async () => {
    const handler = createGetStylesHandler(
      fakeFigma({
        texts: [
          {
            id: 'S:5',
            name: 'Auto',
            key: 'k5',
            description: '',
            fontName: { family: 'Inter', style: 'Bold' },
            fontSize: 12,
            lineHeight: { unit: 'AUTO' },
            letterSpacing: { unit: 'PIXELS', value: 1 },
          },
        ],
      }),
    );
    const result = (await handler(undefined)) as GetStylesResult;
    expect(result.texts[0]?.lineHeight).toEqual({ unit: 'AUTO' });
  });

  it("carries a text style's variable-font axis values", async () => {
    // A design system's weight scale can live entirely on one named instance; without these the
    // whole scale reads back as the same "Inter Regular".
    const handler = createGetStylesHandler(
      fakeFigma({
        texts: [
          {
            id: 'S:6',
            name: 'Heading/H1',
            key: 'k6',
            description: '',
            fontName: { family: 'Inter', style: 'Regular', variationSettings: { wght: 720 } },
            fontSize: 32,
            lineHeight: { unit: 'AUTO' },
            letterSpacing: { unit: 'PIXELS', value: 0 },
          },
        ],
      }),
    );
    const result = (await handler(undefined)) as GetStylesResult;
    expect(result.texts[0]?.fontName).toEqual({
      family: 'Inter',
      style: 'Regular',
      variationSettings: { wght: 720 },
    });
  });

  it('returns empty arrays when the document has no styles', async () => {
    const result = (await createGetStylesHandler(fakeFigma())(undefined)) as GetStylesResult;
    expect(result).toEqual({ paints: [], texts: [], effects: [], grids: [] });
  });
});

// A style's variable bindings are the reason a designer's token survives into code. Figma keeps
// them per paint / effect / grid, and — for typography, whose values are scalars — on the text
// style itself; get_styles used to drop all of them, so a shadow colour bound to a variable was
// indistinguishable from a hard-coded RGBA (issue #164).
describe('get_styles handler — variable bindings', () => {
  const boundStyles = {
    paints: [
      {
        id: 'S:1',
        name: 'Brand/Primary',
        key: 'k1',
        description: '',
        // Two paints, only the second bound — the case a flat style-level list cannot express.
        paints: [
          { type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 1, b: 0 } },
          {
            type: 'SOLID',
            visible: true,
            opacity: 1,
            color: { r: 0.1, g: 0.2, b: 0.3 },
            boundVariables: { color: alias('VariableID:paint') },
          },
        ],
        boundVariables: { paints: [alias('VariableID:paint')] },
      },
    ],
    texts: [
      {
        id: 'S:2',
        name: 'Body',
        key: 'k2',
        description: '',
        fontName: { family: 'Inter', style: 'Regular' },
        fontSize: 24,
        lineHeight: { unit: 'PIXELS', value: 32 },
        letterSpacing: { unit: 'PERCENT', value: 0 },
        textWrapStyle: 'AUTO',
        boundVariables: { fontSize: alias('VariableID:text') },
      },
    ],
    effects: [
      {
        id: 'S:3',
        name: 'Elevation/focus',
        key: 'k3',
        description: '',
        effects: [
          {
            type: 'DROP_SHADOW',
            visible: true,
            radius: 24,
            color: { r: 0.729, g: 0.839, b: 0.898, a: 1 },
            offset: { x: 0, y: 2 },
            spread: 4,
            blendMode: 'NORMAL',
            boundVariables: {
              color: alias('VariableID:effect-color'),
              radius: alias('VariableID:effect-radius'),
            },
          },
        ],
        boundVariables: {
          effects: [alias('VariableID:effect-color'), alias('VariableID:effect-radius')],
        },
      },
    ],
    grids: [
      {
        id: 'S:4',
        name: '12 Col',
        key: 'k4',
        description: '',
        layoutGrids: [
          {
            pattern: 'COLUMNS',
            visible: true,
            count: 12,
            gutterSize: 24,
            alignment: 'STRETCH',
            boundVariables: { gutterSize: alias('VariableID:grid') },
          },
        ],
        boundVariables: { layoutGrids: [alias('VariableID:grid')] },
      },
    ],
  };
  // One variable per binding SITE: a table that reused ids across sites would still pass if
  // collectVariableIds stopped walking one of the four style categories.
  const varTable = {
    'VariableID:paint': { name: 'color/brand', resolvedType: 'COLOR' },
    'VariableID:text': { name: 'size/body', resolvedType: 'FLOAT' },
    'VariableID:effect-color': { name: 'color/information', resolvedType: 'COLOR' },
    'VariableID:effect-radius': {
      name: 'size/lg',
      resolvedType: 'FLOAT',
      codeSyntax: { WEB: '--size-lg' },
    },
    'VariableID:grid': { name: 'size/gutter', resolvedType: 'FLOAT' },
  };

  it('carries the binding on the object that owns it, per style category', async () => {
    const result = (await createGetStylesHandler(fakeFigma(boundStyles, varTable))(
      undefined,
    )) as GetStylesResult;

    const paints = result.paints[0]?.paints ?? [];
    expect(paints[0]).not.toHaveProperty('boundVariables');
    expect(paints[1]).toHaveProperty('boundVariables', { color: 'VariableID:paint' });
    expect(result.texts[0]?.boundVariables).toEqual({ fontSize: 'VariableID:text' });
    expect(result.effects[0]?.effects[0]?.boundVariables).toEqual({
      color: 'VariableID:effect-color',
      radius: 'VariableID:effect-radius',
    });
    expect(result.grids[0]?.grids[0]?.boundVariables).toEqual({ gutterSize: 'VariableID:grid' });
  });

  it('puts the variables table before the styles that cite it', async () => {
    const result = (await createGetStylesHandler(fakeFigma(boundStyles, varTable))(
      undefined,
    )) as GetStylesResult;
    expect(Object.keys(result)[0]).toBe('variables');
  });

  it('keys the variables table in a stable order, not in lookup-completion order', async () => {
    // Resolution is parallel; a table assembled as promises settle would reorder run to run.
    const slow = {
      'VariableID:paint': { name: 'color/brand', resolvedType: 'COLOR' },
      'VariableID:text': { name: 'size/body', resolvedType: 'FLOAT' },
      'VariableID:effect-color': { name: 'color/information', resolvedType: 'COLOR' },
      'VariableID:effect-radius': { name: 'size/lg', resolvedType: 'FLOAT' },
      'VariableID:grid': { name: 'size/gutter', resolvedType: 'FLOAT' },
    };
    const delays: Record<string, number> = {
      'VariableID:paint': 8,
      'VariableID:text': 6,
      'VariableID:effect-color': 4,
      'VariableID:effect-radius': 2,
      'VariableID:grid': 0,
    };
    const figmaCtx = {
      getLocalPaintStylesAsync: async () => boundStyles.paints,
      getLocalTextStylesAsync: async () => boundStyles.texts,
      getLocalEffectStylesAsync: async () => boundStyles.effects,
      getLocalGridStylesAsync: async () => boundStyles.grids,
      variables: {
        getVariableByIdAsync: async (id: string) => {
          await new Promise(r => setTimeout(r, delays[id] ?? 0));
          return slow[id as keyof typeof slow] ?? null;
        },
      },
    } as unknown as typeof figma;
    const result = (await createGetStylesHandler(figmaCtx)(undefined)) as GetStylesResult;
    // Walk order (paints → texts → effects → grids), which is the inverse of the resolve order.
    expect(Object.keys(result.variables ?? {})).toEqual([
      'VariableID:paint',
      'VariableID:text',
      'VariableID:effect-color',
      'VariableID:effect-radius',
      'VariableID:grid',
    ]);
  });

  it('resolves every referenced id to a name, and only those', async () => {
    const result = (await createGetStylesHandler(fakeFigma(boundStyles, varTable))(
      undefined,
    )) as GetStylesResult;
    expect(result.variables).toEqual({
      'VariableID:paint': { name: 'color/brand', type: 'COLOR' },
      'VariableID:text': { name: 'size/body', type: 'FLOAT' },
      'VariableID:effect-color': { name: 'color/information', type: 'COLOR' },
      'VariableID:effect-radius': {
        name: 'size/lg',
        type: 'FLOAT',
        codeSyntax: { WEB: '--size-lg' },
      },
      'VariableID:grid': { name: 'size/gutter', type: 'FLOAT' },
    });
  });

  it('resolves ids referenced only by a gradient stop', async () => {
    const result = (await createGetStylesHandler(
      fakeFigma(
        {
          paints: [
            {
              id: 'S:1',
              name: 'Fade',
              key: 'k1',
              description: '',
              paints: [
                {
                  type: 'GRADIENT_LINEAR',
                  visible: true,
                  opacity: 1,
                  gradientTransform: [
                    [1, 0, 0],
                    [0, 1, 0],
                  ],
                  gradientStops: [
                    {
                      position: 0,
                      color: { r: 0, g: 0, b: 0, a: 1 },
                      boundVariables: { color: alias('VariableID:1') },
                    },
                  ],
                },
              ],
            },
          ],
        },
        { 'VariableID:1': { name: 'color/brand-stop', resolvedType: 'COLOR' } },
      ),
    )(undefined)) as GetStylesResult;
    expect(result.variables).toEqual({
      'VariableID:1': { name: 'color/brand-stop', type: 'COLOR' },
    });
  });

  it('omits the variables table when nothing is bound', async () => {
    const result = (await createGetStylesHandler(
      fakeFigma(
        {
          texts: [
            {
              id: 'S:2',
              name: 'Body',
              key: 'k2',
              description: '',
              fontName: { family: 'Inter', style: 'Regular' },
              fontSize: 16,
              lineHeight: { unit: 'AUTO' },
              letterSpacing: { unit: 'PIXELS', value: 0 },
              textWrapStyle: 'AUTO',
              boundVariables: {},
            },
          ],
        },
        varTable,
      ),
    )(undefined)) as GetStylesResult;
    expect(result).not.toHaveProperty('variables');
    expect(result.texts[0]).not.toHaveProperty('boundVariables');
  });

  it('keeps the styles when a bound variable no longer resolves', async () => {
    const result = (await createGetStylesHandler(fakeFigma(boundStyles, {}))(
      undefined,
    )) as GetStylesResult;
    // The binding is still reported — the id is the honest answer; only the name is unavailable.
    expect(result.effects[0]?.effects[0]?.boundVariables).toEqual({
      color: 'VariableID:effect-color',
      radius: 'VariableID:effect-radius',
    });
    expect(result).not.toHaveProperty('variables');
  });
});
