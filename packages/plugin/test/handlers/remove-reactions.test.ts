import type { MutateResult } from '@figma-mcp-relay/shared';
import { describe, expect, it, vi } from 'vitest';

import { createRemoveReactionsHandler } from '../../src/handlers/remove-reactions.js';

const withNode = (node: unknown): typeof figma =>
  ({ getNodeByIdAsync: async () => node }) as unknown as typeof figma;

describe('remove_reactions handler', () => {
  it('clears reactions by setting an empty array', async () => {
    const setReactionsAsync = vi.fn<() => Promise<void>>(async () => {});
    const node = { id: '1:1', setReactionsAsync };

    const result = (await createRemoveReactionsHandler(withNode(node))({
      nodeId: '1:1',
    })) as MutateResult;
    expect(setReactionsAsync).toHaveBeenCalledWith([]);
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it('throws on bad input or unsupported node', async () => {
    await expect(createRemoveReactionsHandler(withNode({}))({})).rejects.toThrow(/nodeId/);
    await expect(
      createRemoveReactionsHandler(withNode({ id: '1:1' }))({ nodeId: '1:1' }),
    ).rejects.toThrow(/cannot have reactions/);
  });
});
