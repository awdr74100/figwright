import type { BatchNodeResult } from '@figma-mcp-relay/shared';
import { describe, expect, it, vi } from 'vitest';

import { createReparentNodesHandler } from '../../src/handlers/reparent-nodes.js';

const makeFigma = (parent: unknown, children: Record<string, unknown>): typeof figma => {
  const lookup: Record<string, unknown> = { '2:0': parent, ...children };
  return { getNodeByIdAsync: async (id: string) => lookup[id] ?? null } as unknown as typeof figma;
};

describe('reparent_nodes handler', () => {
  it('appends nodes to the new parent and returns affected ids', async () => {
    const appendChild = vi.fn<() => void>();
    const parent = { id: '2:0', appendChild };
    const a = { id: '1:1', parent: { id: '1:0' } };
    const handler = createReparentNodesHandler(makeFigma(parent, { '1:1': a }));
    const result = (await handler({ nodeIds: ['1:1'], newParentId: '2:0' })) as BatchNodeResult;

    expect(appendChild).toHaveBeenCalledWith(a);
    expect(result).toEqual({ ok: true, affected: ['1:1'] });
  });

  it('inserts at index when provided', async () => {
    const insertChild = vi.fn<() => void>();
    const parent = { id: '2:0', appendChild: vi.fn<() => void>(), insertChild };
    const a = { id: '1:1', parent: { id: '1:0' } };
    const handler = createReparentNodesHandler(makeFigma(parent, { '1:1': a }));
    await handler({ nodeIds: ['1:1'], newParentId: '2:0', index: 0 });
    expect(insertChild).toHaveBeenCalledWith(0, a);
  });

  it('throws on bad input or invalid parent', async () => {
    const f = makeFigma(null, {});
    await expect(
      createReparentNodesHandler(f)({ nodeIds: 'x', newParentId: '2:0' }),
    ).rejects.toThrow(/nodeIds/);
    await expect(createReparentNodesHandler(f)({ nodeIds: ['1:1'] })).rejects.toThrow(
      /newParentId/,
    );
    await expect(
      createReparentNodesHandler(f)({ nodeIds: ['1:1'], newParentId: '9:9' }),
    ).rejects.toThrow(/not found or cannot contain/);
  });
});
