import type { CreateResult } from '@figma-mcp-relay/shared';
import { describe, expect, it, vi } from 'vitest';

import { createCreateComponentHandler } from '../../src/handlers/create-component.js';

const makeComponent = () => {
  const node = {
    id: '2:1',
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

const fakeFigma = (
  node: ReturnType<typeof makeComponent>,
  page: { appendChild: (n: unknown) => void },
): typeof figma =>
  ({
    createComponent: () => node,
    currentPage: page,
    getNodeByIdAsync: async () => null,
  }) as unknown as typeof figma;

describe('create_component handler', () => {
  it('creates, sizes, names, and appends to the current page by default', async () => {
    const node = makeComponent();
    const appendChild = vi.fn<(n: unknown) => void>();
    const handler = createCreateComponentHandler(fakeFigma(node, { appendChild }));
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
});
