import type { CreateResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createCreateFrameHandler } from '../../src/handlers/create-frame.js';
import { createCreateRectangleHandler } from '../../src/handlers/create-rectangle.js';
import { createCreateTextHandler } from '../../src/handlers/create-text.js';

const MIXED = Symbol('mixed');

const SOLID = { type: 'SOLID', color: { r: 1, g: 0, b: 0 } };

const setup = (nodeFactory: () => Record<string, unknown>, nodeType: string) => {
  const node: Record<string, unknown> = {
    id: '5:1',
    name: nodeType,
    type: nodeType,
    resize: (w: number, h: number) => Object.assign(node, { width: w, height: h }),
    remove: vi.fn<() => void>(),
    ...nodeFactory(),
  };
  const page = { appendChild: vi.fn<(n: unknown) => void>() };
  const ctx = {
    mixed: MIXED,
    createFrame: () => node,
    createRectangle: () => node,
    createText: () => node,
    currentPage: page,
    loadFontAsync: async () => {},
    getNodeByIdAsync: async (id: string) => (id === '5:1' ? node : null),
    root: { documentColorProfile: 'SRGB' },
  } as unknown as typeof figma;
  return { node, page, ctx };
};

const frameNode = () => ({
  fills: [],
  strokes: [],
  cornerRadius: 0,
  layoutMode: 'NONE',
  layoutWrap: 'NO_WRAP',
  clipsContent: true,
  paddingTop: 0,
  paddingRight: 0,
  paddingBottom: 0,
  paddingLeft: 0,
  itemSpacing: 0,
  primaryAxisAlignItems: 'MIN',
  counterAxisAlignItems: 'MIN',
  layoutSizingHorizontal: 'FIXED',
  layoutSizingVertical: 'FIXED',
  layoutAlign: 'INHERIT',
  layoutGrow: 0,
  layoutPositioning: 'AUTO',
});

describe('create_* initial style', () => {
  it('styles and lays out a frame in the one call that creates it', async () => {
    const { node, ctx } = setup(frameNode, 'FRAME');
    const result = (await createCreateFrameHandler(ctx)({
      name: 'Card',
      fills: [SOLID],
      cornerRadius: 12,
      autoLayout: {
        layoutMode: 'VERTICAL',
        itemSpacing: 8,
        paddingTop: 16,
        paddingRight: 16,
        paddingBottom: 16,
        paddingLeft: 16,
        primaryAxisAlignItems: 'CENTER',
      },
      layoutSizingHorizontal: 'HUG',
      layoutSizingVertical: 'HUG',
    })) as CreateResult;

    expect(result).toMatchObject({ ok: true, nodeId: '5:1', type: 'FRAME' });
    expect(node).toMatchObject({
      layoutMode: 'VERTICAL',
      itemSpacing: 8,
      paddingTop: 16,
      primaryAxisAlignItems: 'CENTER',
      cornerRadius: 12,
      layoutSizingHorizontal: 'HUG',
      layoutSizingVertical: 'HUG',
    });
    expect((node.fills as { type: string }[])[0]).toMatchObject({ type: 'SOLID' });
  });

  it('behaves exactly as before when no style is passed', async () => {
    const { node, page, ctx } = setup(frameNode, 'FRAME');
    await createCreateFrameHandler(ctx)({ name: 'Plain', width: 10, height: 20 });
    expect(page.appendChild).toHaveBeenCalledWith(node);
    expect(node).toMatchObject({ width: 10, height: 20, fills: [], layoutMode: 'NONE' });
  });

  it('enables auto layout before sizing, so HUG has something to hug', async () => {
    const order: string[] = [];
    const { node, ctx } = setup(frameNode, 'FRAME');
    const record = (prop: string, label: string, initial: string): void => {
      let value = initial;
      Object.defineProperty(node, prop, {
        get: () => value,
        set: (v: string) => {
          value = v;
          order.push(`${label}:${v}`);
        },
      });
    };
    record('layoutMode', 'layoutMode', 'NONE');
    record('layoutSizingHorizontal', 'sizing', 'FIXED');
    await createCreateFrameHandler(ctx)({
      layoutSizingHorizontal: 'HUG',
      autoLayout: { layoutMode: 'HORIZONTAL' },
    });
    expect(order.indexOf('layoutMode:HORIZONTAL')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('layoutMode:HORIZONTAL')).toBeLessThan(order.indexOf('sizing:HUG'));
  });

  it('removes the half-built layer and names the failing step when a style is refused', async () => {
    const { node, ctx } = setup(frameNode, 'FRAME');
    await expect(
      createCreateFrameHandler(ctx)({ fills: [SOLID], cornerRadius: -3 }),
    ).rejects.toThrow(/cornerRadius — .*non-negative.*removed/s);
    expect(node.remove).toHaveBeenCalled();
  });

  it('refuses strokeWeight without strokes', async () => {
    const { ctx } = setup(frameNode, 'FRAME');
    await expect(createCreateFrameHandler(ctx)({ strokeWeight: 2 })).rejects.toThrow(
      /need strokes/,
    );
  });

  it('styles a rectangle the same way', async () => {
    const { node, ctx } = setup(
      () => ({ fills: [], strokes: [], cornerRadius: 0, strokeWeight: 1, strokeAlign: 'INSIDE' }),
      'RECTANGLE',
    );
    await createCreateRectangleHandler(ctx)({
      fills: [SOLID],
      strokes: [SOLID],
      strokeWeight: 2,
      cornerRadius: 4,
    });
    expect(node).toMatchObject({ cornerRadius: 4, strokeWeight: 2 });
    expect((node.strokes as unknown[]).length).toBe(1);
  });

  it('sets a new text node’s font, alignment and colour in the same call', async () => {
    const { node, ctx } = setup(
      () => ({
        characters: '',
        fontName: { family: 'Inter', style: 'Regular' },
        fontSize: 12,
        textAlignHorizontal: 'LEFT',
        fills: [],
      }),
      'TEXT',
    );
    await createCreateTextHandler(ctx)({
      characters: 'Hello',
      fontSize: 24,
      textAlignHorizontal: 'CENTER',
      fontName: { family: 'Poppins', style: 'Bold' },
      fills: [SOLID],
    });
    expect(node).toMatchObject({
      characters: 'Hello',
      fontSize: 24,
      textAlignHorizontal: 'CENTER',
      fontName: { family: 'Poppins', style: 'Bold' },
    });
    expect((node.fills as unknown[]).length).toBe(1);
  });
});
