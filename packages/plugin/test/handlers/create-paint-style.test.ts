import type { StyleResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createCreatePaintStyleHandler } from '../../src/handlers/create-paint-style.js';

interface FakePaintStyle {
  id: string;
  name: string;
  paints: unknown;
  description: string;
}

const fakeFigma = (
  variables: Record<string, unknown> = {},
): { figma: typeof figma; created: FakePaintStyle[] } => {
  const created: FakePaintStyle[] = [];
  const figmaCtx = {
    variables: {
      getVariableByIdAsync: async (id: string) => variables[id] ?? null,
      setBoundVariableForPaint: (paint: object, field: string, v: { id: string }) => ({
        ...paint,
        boundVariables: { [field]: { type: 'VARIABLE_ALIAS', id: v.id } },
      }),
    },
    createPaintStyle: () => {
      const style: FakePaintStyle = {
        id: `S:${created.length}`,
        name: '',
        paints: [],
        description: '',
      };
      created.push(style);
      return style;
    },
  } as unknown as typeof figma;
  return { figma: figmaCtx, created };
};

// Measured on main: a value Figma refuses only surfaces on the write, after the style exists, and
// the failed call left the empty, named style in the file. It is removed now; if even that fails,
// the error says so.
const refusingPaintsStyle = (valueProp: string, removable = true) => {
  const state = { removed: 0 };
  const style: Record<string, unknown> = {
    id: 'S:new',
    name: '',
    description: '',
    remove: () => {
      if (!removable) throw new Error('in remove: refused');
      state.removed += 1;
    },
  };
  Object.defineProperty(style, valueProp, {
    get: () => [],
    set: () => {
      throw new Error(`in set_${valueProp}: Property "${valueProp}" failed validation`);
    },
  });
  return { style, state };
};

describe('create_paint_style handler', () => {
  it('creates a paint style with name + SOLID paints and returns styleId + name', async () => {
    const { figma: f, created } = fakeFigma();
    const handler = createCreatePaintStyleHandler(f);
    const result = (await handler({
      name: 'Brand/Primary',
      paints: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0 } }],
      description: 'main',
    })) as StyleResult;

    expect(created[0]?.name).toBe('Brand/Primary');
    expect(created[0]?.paints).toEqual([
      { type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1, visible: true },
    ]);
    expect(created[0]?.description).toBe('main');
    expect(result).toEqual({ ok: true, styleId: 'S:0', name: 'Brand/Primary' });
  });

  it('throws on bad input', async () => {
    const { figma: f } = fakeFigma();
    const handler = createCreatePaintStyleHandler(f);
    await expect(handler({ paints: [] })).rejects.toThrow(/name/);
    await expect(handler({ name: 'x', paints: 'nope' })).rejects.toThrow(/paints/);
  });

  // A style whose paints cite a variable that no longer exists must fail before the style exists:
  // Figma has no transaction, so a style created first would be left behind in the design-system
  // panel — and published to the library from there (the create_text_style lesson).
  it('creates nothing when a bound variable cannot be resolved', async () => {
    const { figma: f, created } = fakeFigma();
    const handler = createCreatePaintStyleHandler(f);
    await expect(
      handler({
        name: 'Brand/Primary',
        paints: [
          {
            type: 'SOLID',
            visible: true,
            opacity: 1,
            color: { r: 1, g: 0, b: 0 },
            boundVariables: { color: 'V:gone' },
          },
        ],
      }),
    ).rejects.toThrow('create_paint_style: variable V:gone not found');
    expect(created).toEqual([]);
  });

  it('carries a paint binding onto the created style', async () => {
    const { figma: f, created } = fakeFigma({
      'V:1': { id: 'V:1', name: 'color/brand', resolvedType: 'COLOR' },
    });
    await createCreatePaintStyleHandler(f)({
      name: 'Brand/Primary',
      paints: [
        {
          type: 'SOLID',
          visible: true,
          opacity: 1,
          color: { r: 1, g: 0, b: 0 },
          boundVariables: { color: 'V:1' },
        },
      ],
    });
    expect(created[0]?.paints).toEqual([
      expect.objectContaining({ boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'V:1' } } }),
    ]);
  });

  it('removes the style it created when Figma refuses its value, and passes the refusal on', async () => {
    const { style, state } = refusingPaintsStyle('paints');
    const figmaCtx = {
      variables: {
        getVariableByIdAsync: async () => null,
        setBoundVariableForPaint: (p: object) => p,
      },
      createPaintStyle: () => style,
    } as unknown as typeof figma;
    await expect(
      createCreatePaintStyleHandler(figmaCtx)({
        name: 'Brand',
        paints: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 2 }],
      }),
    ).rejects.toThrow(/^in set_paints: Property "paints" failed validation$/);
    expect(state.removed).toBe(1);
  });

  it('says so when the style it created cannot be removed', async () => {
    const { style } = refusingPaintsStyle('paints', false);
    const figmaCtx = {
      variables: {
        getVariableByIdAsync: async () => null,
        setBoundVariableForPaint: (p: object) => p,
      },
      createPaintStyle: () => style,
    } as unknown as typeof figma;
    await expect(
      createCreatePaintStyleHandler(figmaCtx)({
        name: 'Brand',
        paints: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 2 }],
      }),
    ).rejects.toThrow(
      'failed validation — and the new style S:new could not be removed: in remove: refused',
    );
  });
});
