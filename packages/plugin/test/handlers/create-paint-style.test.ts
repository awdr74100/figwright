import type { StyleResult } from '@figma-mcp-relay/shared';
import { describe, expect, it } from 'vitest';

import { createCreatePaintStyleHandler } from '../../src/handlers/create-paint-style.js';

interface FakePaintStyle {
  id: string;
  name: string;
  paints: unknown;
  description: string;
}

const fakeFigma = (): { figma: typeof figma; created: FakePaintStyle[] } => {
  const created: FakePaintStyle[] = [];
  const figmaCtx = {
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
});
