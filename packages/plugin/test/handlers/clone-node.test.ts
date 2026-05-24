import type { CreateResult } from '@figma-mcp-relay/shared';
import { describe, expect, it, vi } from 'vitest';

import { createCloneNodeHandler } from '../../src/handlers/clone-node.js';

const fakeFigma = (lookup: Record<string, unknown>, currentPage = { appendChild: vi.fn<(n: unknown) => void>() }): typeof figma =>
  ({
    currentPage,
    getNodeByIdAsync: async (id: string) => lookup[id] ?? null,
  }) as unknown as typeof figma;

describe('clone_node handler', () => {
  it('clones a node and appends the copy to the original parent', async () => {
    const copy = { id: '1:9', name: 'Box', type: 'RECTANGLE' };
    const parent = { id: '1:0', appendChild: vi.fn<(n: unknown) => void>() };
    const node = { id: '1:1', parent, clone: () => copy };
    const handler = createCloneNodeHandler(fakeFigma({ '1:1': node }));
    const result = (await handler({ nodeId: '1:1' })) as CreateResult;

    expect(parent.appendChild).toHaveBeenCalledWith(copy);
    expect(result).toEqual({ ok: true, nodeId: '1:9', name: 'Box', type: 'RECTANGLE' });
  });

  it('throws when the node is missing or not cloneable', async () => {
    const handler = createCloneNodeHandler(fakeFigma({ '1:1': { id: '1:1' } }));
    await expect(handler({ nodeId: '1:1' })).rejects.toThrow(/cannot be cloned/);
    await expect(handler({ nodeId: '9:9' })).rejects.toThrow(/not found/);
    await expect(handler({})).rejects.toThrow(/nodeId/);
  });
});
