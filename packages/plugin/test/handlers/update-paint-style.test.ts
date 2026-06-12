import type { StyleResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createUpdatePaintStyleHandler } from '../../src/handlers/update-paint-style.js';

const fakeFigma = (style: unknown): typeof figma =>
  ({ getStyleByIdAsync: async () => style }) as unknown as typeof figma;

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
});
