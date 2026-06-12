import type { BatchNodeResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createReorderNodesHandler } from '../../src/handlers/reorder-nodes.js';

describe('reorder_nodes handler', () => {
  it('inserts each node at the index within its parent', async () => {
    const insertChild = vi.fn<() => void>();
    const parent = { id: '1:0', insertChild };
    const a = { id: '1:1', parent };
    const f = {
      getNodeByIdAsync: async (id: string) => (id === '1:1' ? a : null),
    } as unknown as typeof figma;

    const result = (await createReorderNodesHandler(f)({
      nodeIds: ['1:1'],
      index: 2,
    })) as BatchNodeResult;
    expect(insertChild).toHaveBeenCalledWith(2, a);
    expect(result).toEqual({ ok: true, affected: ['1:1'] });
  });

  it('skips detached nodes and throws on bad input', async () => {
    const detached = { id: '1:1', parent: null };
    const f = {
      getNodeByIdAsync: async () => detached,
    } as unknown as typeof figma;
    const result = (await createReorderNodesHandler(f)({
      nodeIds: ['1:1'],
      index: 0,
    })) as BatchNodeResult;
    expect(result).toEqual({ ok: true, affected: [] });

    await expect(createReorderNodesHandler(f)({ nodeIds: ['1:1'] })).rejects.toThrow(/index/);
  });
});
