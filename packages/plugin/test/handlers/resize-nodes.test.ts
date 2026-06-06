import type { BatchNodeResult } from '@figma-mcp-relay/shared';
import { describe, expect, it, vi } from 'vitest';

import { createResizeNodesHandler } from '../../src/handlers/resize-nodes.js';

const fakeFigma = (lookup: Record<string, unknown>): typeof figma =>
  ({ getNodeByIdAsync: async (id: string) => lookup[id] ?? null }) as unknown as typeof figma;

describe('resize_nodes handler', () => {
  it('resizes resizable nodes and skips the rest', async () => {
    const a = { id: '1:1', resize: vi.fn<(w: number, h: number) => void>() };
    const noResize = { id: '1:2' };
    const handler = createResizeNodesHandler(fakeFigma({ '1:1': a, '1:2': noResize }));
    const result = (await handler({
      nodeIds: ['1:1', '1:2', '9:9'],
      width: 200,
      height: 80,
    })) as BatchNodeResult;

    expect(a.resize).toHaveBeenCalledWith(200, 80);
    expect(result).toEqual({ ok: true, affected: ['1:1'] });
  });

  it('throws on non-positive dimensions and bad input', async () => {
    const handler = createResizeNodesHandler(fakeFigma({}));
    await expect(handler({ nodeIds: ['1:1'], width: 0, height: 10 })).rejects.toThrow(
      /width and height/,
    );
    await expect(handler({ nodeIds: 'x', width: 1, height: 1 })).rejects.toThrow(/nodeIds/);
  });
});
