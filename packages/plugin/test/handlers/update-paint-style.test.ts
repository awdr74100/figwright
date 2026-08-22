import type { StyleResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createUpdatePaintStyleHandler } from '../../src/handlers/update-paint-style.js';

const fakeFigma = (style: unknown, variables: Record<string, unknown> = {}): typeof figma =>
  ({
    getStyleByIdAsync: async () => style,
    variables: {
      getVariableByIdAsync: async (id: string) => variables[id] ?? null,
      setBoundVariableForPaint: (paint: object, field: string, v: { id: string }) => ({
        ...paint,
        boundVariables: { [field]: { type: 'VARIABLE_ALIAS', id: v.id } },
      }),
    },
  }) as unknown as typeof figma;

describe('update_paint_style handler', () => {
  it('updates name + paints of an existing paint style', async () => {
    const style = { id: 'S:0', type: 'PAINT', name: 'old', paints: [] as unknown, description: '' };
    const handler = createUpdatePaintStyleHandler(fakeFigma(style));
    const result = (await handler({
      styleId: 'S:0',
      name: 'new',
      paints: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 1, b: 0 } }],
    })) as StyleResult;

    expect(style.name).toBe('new');
    expect(style.paints).toEqual([
      { type: 'SOLID', color: { r: 0, g: 1, b: 0 }, opacity: 1, visible: true },
    ]);
    expect(result).toEqual({ ok: true, styleId: 'S:0', name: 'new' });
  });

  it('throws when style is missing or not a paint style', async () => {
    await expect(
      createUpdatePaintStyleHandler(fakeFigma(null))({ styleId: 'S:9' }),
    ).rejects.toThrow(/not found/);
    await expect(
      createUpdatePaintStyleHandler(fakeFigma({ id: 'S:0', type: 'TEXT' }))({ styleId: 'S:0' }),
    ).rejects.toThrow(/not found/);
    await expect(createUpdatePaintStyleHandler(fakeFigma(null))({})).rejects.toThrow(/styleId/);
  });

  // Re-syncing a style from code is the common case, and it is where a binding gets clobbered:
  // paints replace wholesale, so the binding has to be re-sent — and then actually applied.
  it('re-applies a binding sent with the new paints', async () => {
    const style = { id: 'S:0', type: 'PAINT', name: 'n', paints: [] as unknown, description: '' };
    await createUpdatePaintStyleHandler(
      fakeFigma(style, { 'V:1': { id: 'V:1', name: 'token', resolvedType: 'COLOR' } }),
    )({
      styleId: 'S:0',
      paints: [
        {
          type: 'SOLID',
          visible: true,
          opacity: 1,
          color: { r: 0, g: 1, b: 0 },
          boundVariables: { color: 'V:1' },
        },
      ],
    });
    expect(style.paints).toEqual([
      expect.objectContaining({ boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'V:1' } } }),
    ]);
  });

  it('leaves the style untouched when a bound variable cannot be resolved', async () => {
    const style = { id: 'S:0', type: 'PAINT', name: 'n', paints: 'UNTOUCHED', description: '' };
    await expect(
      createUpdatePaintStyleHandler(fakeFigma(style))({
        styleId: 'S:0',
        paints: [
          {
            type: 'SOLID',
            visible: true,
            opacity: 1,
            color: { r: 0, g: 1, b: 0 },
            boundVariables: { color: 'V:gone' },
          },
        ],
      }),
    ).rejects.toThrow('update_paint_style: variable V:gone not found');
    expect(style.paints).toBe('UNTOUCHED');
  });
});
