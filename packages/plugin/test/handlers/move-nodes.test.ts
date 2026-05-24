import type { BatchNodeResult } from '@figma-mcp-relay/shared';
import { describe, expect, it } from 'vitest';

import { createMoveNodesHandler } from '../../src/handlers/move-nodes.js';

const fakeFigma = (lookup: Record<string, unknown>): typeof figma =>
  ({ getNodeByIdAsync: async (id: string) => lookup[id] ?? null }) as unknown as typeof figma;

describe('move_nodes handler', () => {
  it('translates positioned nodes by (dx, dy) and skips the rest', async () => {
    const a = { id: '1:1', x: 10, y: 20 };
    const noPos = { id: '1:2' };
    const handler = createMoveNodesHandler(fakeFigma({ '1:1': a, '1:2': noPos }));
    const result = (await handler({
      nodeIds: ['1:1', '1:2', '9:9'],
      dx: 5,
      dy: -3,
    })) as BatchNodeResult;

    expect([a.x, a.y]).toEqual([15, 17]);
    expect(result).toEqual({ ok: true, affected: ['1:1'] });
  });

  it('defaults dx/dy to 0 and throws on bad input', async () => {
    const a = { id: '1:1', x: 1, y: 1 };
    const handler = createMoveNodesHandler(fakeFigma({ '1:1': a }));
    await handler({ nodeIds: ['1:1'] });
    expect([a.x, a.y]).toEqual([1, 1]);
    await expect(handler({ nodeIds: 'x' })).rejects.toThrow(/nodeIds/);
  });
});
