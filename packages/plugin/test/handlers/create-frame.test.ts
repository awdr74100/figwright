import type { CreateResult } from '@figma-mcp-relay/shared';
import { describe, expect, it, vi } from 'vitest';

import { createCreateFrameHandler } from '../../src/handlers/create-frame.js';

interface FakeFrame {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  resize: (w: number, h: number) => void;
  remove: () => void;
}

const makeFrame = (): FakeFrame => {
  const frame: FakeFrame = {
    id: '2:1',
    name: 'Frame',
    type: 'FRAME',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    resize(w, h) {
      frame.width = w;
      frame.height = h;
    },
    remove: vi.fn<() => void>(),
  };
  return frame;
};

const fakeFigma = (
  frame: FakeFrame,
  currentPage: { appendChild: (n: unknown) => void },
  lookup: Record<string, unknown> = {},
): typeof figma =>
  ({
    createFrame: () => frame,
    currentPage,
    getNodeByIdAsync: async (id: string) => lookup[id] ?? null,
  }) as unknown as typeof figma;

describe('create_frame handler', () => {
  it('creates a sized/named frame on the current page by default', async () => {
    const frame = makeFrame();
    const currentPage = { appendChild: vi.fn<(n: unknown) => void>() };
    const handler = createCreateFrameHandler(fakeFigma(frame, currentPage));
    const result = (await handler({
      name: 'Card',
      width: 200,
      height: 120,
      x: 10,
      y: 20,
    })) as CreateResult;

    expect(frame.name).toBe('Card');
    expect([frame.width, frame.height]).toEqual([200, 120]);
    expect([frame.x, frame.y]).toEqual([10, 20]);
    expect(currentPage.appendChild).toHaveBeenCalledWith(frame);
    expect(result).toEqual({ ok: true, nodeId: '2:1', name: 'Card', type: 'FRAME' });
  });

  it('appends into a given parent', async () => {
    const frame = makeFrame();
    const parent = { id: '1:1', appendChild: vi.fn<(n: unknown) => void>() };
    const handler = createCreateFrameHandler(
      fakeFigma(frame, { appendChild: vi.fn<(n: unknown) => void>() }, { '1:1': parent }),
    );
    await handler({ parentId: '1:1' });
    expect(parent.appendChild).toHaveBeenCalledWith(frame);
  });

  it('removes the orphan frame and throws when the parent is invalid', async () => {
    const frame = makeFrame();
    const handler = createCreateFrameHandler(
      fakeFigma(frame, { appendChild: vi.fn<(n: unknown) => void>() }, {}),
    );
    await expect(handler({ parentId: '9:9' })).rejects.toThrow(/parent/);
    expect(frame.remove).toHaveBeenCalled();
  });
});
