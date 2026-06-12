import type { CreateResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createCreateEllipseHandler } from '../../src/handlers/create-ellipse.js';

const makeEllipse = () => {
  const node = {
    id: '2:1',
    name: 'Ellipse',
    type: 'ELLIPSE',
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
  node: ReturnType<typeof makeEllipse>,
  currentPage: { appendChild: (n: unknown) => void },
  lookup: Record<string, unknown> = {},
): typeof figma =>
  ({
    createEllipse: () => node,
    currentPage,
    getNodeByIdAsync: async (id: string) => lookup[id] ?? null,
  }) as unknown as typeof figma;

describe('create_ellipse handler', () => {
  it('creates, sizes, names, and appends to a given parent', async () => {
    const node = makeEllipse();
    const parent = { id: '1:1', appendChild: vi.fn<(n: unknown) => void>() };
    const handler = createCreateEllipseHandler(
      fakeFigma(node, { appendChild: vi.fn<(n: unknown) => void>() }, { '1:1': parent }),
    );
    const result = (await handler({
      parentId: '1:1',
      name: 'Dot',
      width: 20,
      height: 20,
    })) as CreateResult;

    expect(node.name).toBe('Dot');
    expect([node.width, node.height]).toEqual([20, 20]);
    expect(parent.appendChild).toHaveBeenCalledWith(node);
    expect(result).toEqual({ ok: true, nodeId: '2:1', name: 'Dot', type: 'ELLIPSE' });
  });

  it('removes the orphan and throws on an invalid parent', async () => {
    const node = makeEllipse();
    const handler = createCreateEllipseHandler(
      fakeFigma(node, { appendChild: vi.fn<(n: unknown) => void>() }, {}),
    );
    await expect(handler({ parentId: '9:9' })).rejects.toThrow(/parent/);
    expect(node.remove).toHaveBeenCalled();
  });
});
