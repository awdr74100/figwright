import type { StyleResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createCreateEffectStyleHandler } from '../../src/handlers/create-effect-style.js';

const fakeFigma = (
  variables: Record<string, unknown> = {},
): { figma: typeof figma; style: Record<string, unknown>; creations: () => number } => {
  const style: Record<string, unknown> = { id: 'E:0', name: '' };
  let created = 0;
  const figmaCtx = {
    variables: {
      getVariableByIdAsync: async (id: string) => variables[id] ?? null,
      setBoundVariableForEffect: (effect: object, field: string, v: { id: string }) => ({
        ...effect,
        boundVariables: {
          ...(effect as { boundVariables?: object }).boundVariables,
          [field]: { type: 'VARIABLE_ALIAS', id: v.id },
        },
      }),
    },
    createEffectStyle: () => {
      created += 1;
      return style;
    },
  } as unknown as typeof figma;
  return { figma: figmaCtx, style, creations: () => created };
};

// Measured on main: a value Figma refuses only surfaces on the write, after the style exists, and
// the failed call left the empty, named style in the file. It is removed now; if even that fails,
// the error says so.
const refusingEffectsStyle = (valueProp: string, removable = true) => {
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

describe('create_effect_style handler', () => {
  it('creates an effect style from a blur effect', async () => {
    const { figma: f, style } = fakeFigma();
    const handler = createCreateEffectStyleHandler(f);
    const result = (await handler({
      name: 'Elevation/Blur',
      effects: [{ type: 'LAYER_BLUR', visible: true, radius: 8 }],
    })) as StyleResult;

    expect(style.effects).toEqual([{ type: 'LAYER_BLUR', visible: true, radius: 8 }]);
    expect(result).toEqual({ ok: true, styleId: 'E:0', name: 'Elevation/Blur' });
  });

  it('throws on bad input', async () => {
    const { figma: f } = fakeFigma();
    const handler = createCreateEffectStyleHandler(f);
    await expect(handler({ effects: [] })).rejects.toThrow(/name/);
    await expect(handler({ name: 'x', effects: 'no' })).rejects.toThrow(/effects/);
  });

  // Same rule as create_paint_style: resolve the bindings first, or a bad id leaves a style behind.
  it('creates nothing when a bound variable cannot be resolved', async () => {
    const { figma: f, creations } = fakeFigma();
    await expect(
      createCreateEffectStyleHandler(f)({
        name: 'Elevation/focus',
        effects: [
          {
            type: 'DROP_SHADOW',
            visible: true,
            radius: 4,
            color: { r: 0, g: 0, b: 0, a: 0.2 },
            offset: { x: 0, y: 2 },
            boundVariables: { color: 'V:gone' },
          },
        ],
      }),
    ).rejects.toThrow('create_effect_style: variable V:gone not found');
    expect(creations()).toBe(0);
  });

  it('carries a shadow binding onto the created style', async () => {
    const { figma: f, style } = fakeFigma({
      'V:1': { id: 'V:1', name: 'color/information', resolvedType: 'COLOR' },
    });
    await createCreateEffectStyleHandler(f)({
      name: 'Elevation/focus',
      effects: [
        {
          type: 'DROP_SHADOW',
          visible: true,
          radius: 4,
          color: { r: 0, g: 0, b: 0, a: 0.2 },
          offset: { x: 0, y: 2 },
          boundVariables: { color: 'V:1' },
        },
      ],
    });
    expect(style.effects).toEqual([
      expect.objectContaining({ boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'V:1' } } }),
    ]);
  });

  it('removes the style it created when Figma refuses its value, and passes the refusal on', async () => {
    const { style, state } = refusingEffectsStyle('effects');
    const figmaCtx = {
      variables: {
        getVariableByIdAsync: async () => null,
        setBoundVariableForEffect: (e: object) => e,
      },
      createEffectStyle: () => style,
    } as unknown as typeof figma;
    await expect(
      createCreateEffectStyleHandler(figmaCtx)({
        name: 'Blur',
        effects: [{ type: 'LAYER_BLUR', radius: -5, visible: true }],
      }),
    ).rejects.toThrow(/^in set_effects: Property "effects" failed validation$/);
    expect(state.removed).toBe(1);
  });

  it('says so when the style it created cannot be removed', async () => {
    const { style } = refusingEffectsStyle('effects', false);
    const figmaCtx = {
      variables: {
        getVariableByIdAsync: async () => null,
        setBoundVariableForEffect: (e: object) => e,
      },
      createEffectStyle: () => style,
    } as unknown as typeof figma;
    await expect(
      createCreateEffectStyleHandler(figmaCtx)({
        name: 'Blur',
        effects: [{ type: 'LAYER_BLUR', radius: -5, visible: true }],
      }),
    ).rejects.toThrow(
      'failed validation — and the new style S:new could not be removed: in remove: refused',
    );
  });
});
