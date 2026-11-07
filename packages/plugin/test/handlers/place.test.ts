import { describe, expect, it, vi } from 'vitest';

import { createCreateRectangleHandler } from '../../src/handlers/create-rectangle.js';
import { placeNode } from '../../src/handlers/place.js';

const newNode = () => ({ id: '9:1', remove: vi.fn<() => void>() }) as unknown as SceneNode;

const ctxWith = (parents: Record<string, unknown>) =>
  ({
    currentPage: { appendChild: vi.fn<(n: unknown) => void>() },
    getNodeByIdAsync: async (id: string) => parents[id] ?? null,
  }) as unknown as typeof figma;

// Measured: a component set takes only components, and an instance takes no new layers — Figma
// throws "Cannot move node" from appendChild. A created node is already on the current page by
// then, so the failed create used to leave it there.
const refusing = {
  id: '5:5',
  type: 'COMPONENT_SET',
  appendChild: () => {
    throw new Error(
      'in appendChild: Cannot move node. A COMPONENT_SET node cannot have children of type other than COMPONENT',
    );
  },
};

describe('placeNode', () => {
  it('appends to the current page without a parentId', async () => {
    const ctx = ctxWith({});
    const node = newNode();
    await placeNode(ctx, node, undefined, 'create_x');
    expect(ctx.currentPage.appendChild).toHaveBeenCalledWith(node);
  });

  it('appends to the parent it is given', async () => {
    const parent = { id: '1:1', appendChild: vi.fn<(n: unknown) => void>() };
    const node = newNode();
    await placeNode(ctxWith({ '1:1': parent }), node, '1:1', 'create_x');
    expect(parent.appendChild).toHaveBeenCalledWith(node);
  });

  it('removes the new node when the parent is missing', async () => {
    const node = newNode();
    await expect(placeNode(ctxWith({}), node, '7:7', 'create_x')).rejects.toThrow(
      /create_x: parent 7:7 not found/,
    );
    expect(node.remove).toHaveBeenCalledOnce();
  });

  it('removes the new node when the parent refuses it, naming why', async () => {
    const node = newNode();
    await expect(placeNode(ctxWith({ '5:5': refusing }), node, '5:5', 'create_x')).rejects.toThrow(
      'create_x: in appendChild: Cannot move node. A COMPONENT_SET node cannot have children of type other than COMPONENT (the new layer was removed)',
    );
    expect(node.remove).toHaveBeenCalledOnce();
  });

  it('leaves no rectangle behind when create_rectangle is refused by its parent', async () => {
    const rect = {
      id: '9:2',
      name: '',
      width: 100,
      height: 100,
      resize: vi.fn<(w: number, h: number) => void>(),
      remove: vi.fn<() => void>(),
    };
    const ctx = {
      ...ctxWith({ '5:5': refusing }),
      createRectangle: () => rect,
    } as unknown as typeof figma;
    await expect(
      createCreateRectangleHandler(ctx)({ parentId: '5:5', width: 10, height: 10 }),
    ).rejects.toThrow(/the new layer was removed/);
    expect(rect.remove).toHaveBeenCalledOnce();
  });
});
