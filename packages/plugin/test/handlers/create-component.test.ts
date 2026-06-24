import type { CreateResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createCreateComponentHandler } from '../../src/handlers/create-component.js';

const makeComponent = (id = '2:1') => {
  const node = {
    id,
    name: 'Component',
    type: 'COMPONENT',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    resize(w: number, h: number) {
      node.width = w;
      node.height = h;
    },
    remove: vi.fn<() => void>(),
  };
  return node;
};

const fakeFigma = (opts: {
  component?: ReturnType<typeof makeComponent>;
  fromComponent?: ReturnType<typeof makeComponent>;
  createComponentFromNode?: ReturnType<typeof vi.fn>;
  lookup?: Record<string, unknown>;
  page?: { appendChild: (n: unknown) => void };
}): typeof figma =>
  ({
    createComponent: () => opts.component ?? makeComponent(),
    createComponentFromNode:
      opts.createComponentFromNode ?? vi.fn<(n: unknown) => unknown>(() => opts.fromComponent),
    currentPage: opts.page ?? { appendChild: vi.fn<(n: unknown) => void>() },
    getNodeByIdAsync: async (id: string) => opts.lookup?.[id] ?? null,
  }) as unknown as typeof figma;

describe('create_component handler', () => {
  it('creates an empty component, sizes/names it, and appends to the current page by default', async () => {
    const node = makeComponent();
    const appendChild = vi.fn<(n: unknown) => void>();
    const handler = createCreateComponentHandler(
      fakeFigma({ component: node, page: { appendChild } }),
    );
    const result = (await handler({
      name: 'Button',
      width: 120,
      height: 40,
      x: 10,
      y: 5,
    })) as CreateResult;

    expect(node.name).toBe('Button');
    expect([node.width, node.height, node.x, node.y]).toEqual([120, 40, 10, 5]);
    expect(appendChild).toHaveBeenCalledWith(node);
    expect(result).toEqual({ ok: true, nodeId: '2:1', name: 'Button', type: 'COMPONENT' });
  });

  it('componentizes an existing node via fromNodeId and leaves it in place (no reparent)', async () => {
    const source = { id: 'SRC:1', type: 'FRAME' };
    const made = makeComponent('C:9');
    const createComponentFromNode = vi.fn<(n: unknown) => unknown>(() => made);
    const appendChild = vi.fn<(n: unknown) => void>();
    const handler = createCreateComponentHandler(
      fakeFigma({ createComponentFromNode, lookup: { 'SRC:1': source }, page: { appendChild } }),
    );

    const result = (await handler({ fromNodeId: 'SRC:1', name: 'Logo' })) as CreateResult;

    expect(createComponentFromNode).toHaveBeenCalledWith(source);
    expect(appendChild).not.toHaveBeenCalled(); // stays where the source node was
    expect(result).toEqual({ ok: true, nodeId: 'C:9', name: 'Logo', type: 'COMPONENT' });
  });

  it('throws when fromNodeId is missing or not componentizable', async () => {
    await expect(
      createCreateComponentHandler(fakeFigma({}))({ fromNodeId: 'GONE:1' }),
    ).rejects.toThrow(/not found/);
    await expect(
      createCreateComponentHandler(fakeFigma({ lookup: { 'P:1': { id: 'P:1', type: 'PAGE' } } }))({
        fromNodeId: 'P:1',
      }),
    ).rejects.toThrow(/can't be turned into a component/);
  });
});
