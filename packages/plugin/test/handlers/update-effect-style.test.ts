import type { StyleResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createUpdateEffectStyleHandler } from '../../src/handlers/update-effect-style.js';

const fakeFigma = (style: unknown, variables: Record<string, unknown> = {}): typeof figma =>
  ({
    getStyleByIdAsync: async () => style,
    variables: {
      getVariableByIdAsync: async (id: string) => variables[id] ?? null,
      setBoundVariableForEffect: (effect: object, field: string, v: { id: string }) => ({
        ...effect,
        boundVariables: { [field]: { type: 'VARIABLE_ALIAS', id: v.id } },
      }),
    },
  }) as unknown as typeof figma;

describe('update_effect_style handler', () => {
  it('replaces effects + name and leaves an omitted field unchanged', async () => {
    const style = {
      id: 'E:0',
      type: 'EFFECT',
      name: 'old',
      effects: [] as unknown,
      description: 'keep',
    };
    const result = (await createUpdateEffectStyleHandler(fakeFigma(style))({
      styleId: 'E:0',
      name: 'Elevation/Card',
      effects: [{ type: 'LAYER_BLUR', visible: true, radius: 8 }],
    })) as StyleResult;

    expect(style.name).toBe('Elevation/Card');
    expect(style.effects).toEqual([{ type: 'LAYER_BLUR', visible: true, radius: 8 }]);
    expect(style.description).toBe('keep'); // omitted → unchanged
    expect(result).toEqual({ ok: true, styleId: 'E:0', name: 'Elevation/Card' });
  });

  it('throws when the style is missing or not an effect style', async () => {
    await expect(
      createUpdateEffectStyleHandler(fakeFigma(null))({ styleId: 'E:9' }),
    ).rejects.toThrow(/not found/);
    await expect(
      createUpdateEffectStyleHandler(fakeFigma({ id: 'E:0', type: 'PAINT' }))({ styleId: 'E:0' }),
    ).rejects.toThrow(/not found/);
    await expect(createUpdateEffectStyleHandler(fakeFigma(null))({})).rejects.toThrow(/styleId/);
  });

  it('re-applies a binding sent with the new effects', async () => {
    const style = { id: 'E:0', type: 'EFFECT', name: 'n', effects: [] as unknown, description: '' };
    await createUpdateEffectStyleHandler(
      fakeFigma(style, { 'V:1': { id: 'V:1', name: 'token', resolvedType: 'COLOR' } }),
    )({
      styleId: 'E:0',
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
});
