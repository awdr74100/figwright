import type { CreateResult } from '@figma-mcp-relay/shared';
import { describe, expect, it, vi } from 'vitest';

import { createCreateRectangleHandler } from '../../src/handlers/create-rectangle.js';

const makeRect = () => {
  const rect = {
    id: '2:1',
    name: 'Rectangle',
    type: 'RECTANGLE',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    resize(w: number, h: number) {
      rect.width = w;
      rect.height = h;
    },
    remove: vi.fn<() => void>(),
  };
  return rect;
};

const fakeFigma = (
  rect: ReturnType<typeof makeRect>,
  currentPage: { appendChild: (n: unknown) => void },
  lookup: Record<string, unknown> = {},
): typeof figma =>
  ({
    createRectangle: () => rect,
    currentPage,
    getNodeByIdAsync: async (id: string) => lookup[id] ?? null,
  }) as unknown as typeof figma;

describe('create_rectangle handler', () => {
  it('creates, sizes, names, and appends to a given parent', async () => {
    const rect = makeRect();
    const parent = { id: '1:1', appendChild: vi.fn<(n: unknown) => void>() };
    const handler = createCreateRectangleHandler(
      fakeFigma(rect, { appendChild: vi.fn<(n: unknown) => void>() }, { '1:1': parent }),
    );
    const result = (await handler({
      parentId: '1:1',
      name: 'Box',
      width: 50,
      height: 30,
    })) as CreateResult;

    expect(rect.name).toBe('Box');
    expect([rect.width, rect.height]).toEqual([50, 30]);
    expect(parent.appendChild).toHaveBeenCalledWith(rect);
    expect(result).toEqual({ ok: true, nodeId: '2:1', name: 'Box', type: 'RECTANGLE' });
  });

  it('removes the orphan and throws on an invalid parent', async () => {
    const rect = makeRect();
    const handler = createCreateRectangleHandler(fakeFigma(rect, { appendChild: vi.fn<(n: unknown) => void>() }, {}));
    await expect(handler({ parentId: '9:9' })).rejects.toThrow(/parent/);
    expect(rect.remove).toHaveBeenCalled();
  });
});
