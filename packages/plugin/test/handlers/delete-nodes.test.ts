import type { BatchNodeResult } from '@figma-mcp-relay/shared';
import { describe, expect, it, vi } from 'vitest';

import { createDeleteNodesHandler } from '../../src/handlers/delete-nodes.js';

const fakeFigma = (lookup: Record<string, unknown>): typeof figma =>
  ({ getNodeByIdAsync: async (id: string) => lookup[id] ?? null }) as unknown as typeof figma;

describe('delete_nodes handler', () => {
  it('removes found nodes and reports only the affected ids', async () => {
    const a = { id: '1:1', remove: vi.fn<() => void>() };
    const b = { id: '1:2', remove: vi.fn<() => void>() };
    const handler = createDeleteNodesHandler(fakeFigma({ '1:1': a, '1:2': b }));
    const result = (await handler({ nodeIds: ['1:1', '9:9', '1:2'] })) as BatchNodeResult;

    expect(a.remove).toHaveBeenCalled();
    expect(b.remove).toHaveBeenCalled();
    expect(result).toEqual({ ok: true, affected: ['1:1', '1:2'] }); // 9:9 missing → skipped
  });

  it('skips nodes whose remove() throws (e.g. already removed via an ancestor)', async () => {
    const a = {
      id: '1:1',
      remove: () => {
        throw new Error('already removed');
      },
    };
    const handler = createDeleteNodesHandler(fakeFigma({ '1:1': a }));
    const result = (await handler({ nodeIds: ['1:1'] })) as BatchNodeResult;
    expect(result.affected).toEqual([]);
  });

  it('throws on bad input', async () => {
    const handler = createDeleteNodesHandler(fakeFigma({}));
    await expect(handler({ nodeIds: 'x' })).rejects.toThrow(/nodeIds/);
    await expect(handler({ nodeIds: [1] })).rejects.toThrow(/nodeIds/);
  });
});
