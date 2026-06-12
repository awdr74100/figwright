import type { MutateResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createSetReactionsHandler } from '../../src/handlers/set-reactions.js';

const withNode = (node: unknown): typeof figma =>
  ({ getNodeByIdAsync: async () => node }) as unknown as typeof figma;

describe('set_reactions handler', () => {
  it('converts and applies reactions via setReactionsAsync', async () => {
    const setReactionsAsync = vi.fn<() => Promise<void>>(async () => {});
    const node = { id: '1:1', setReactionsAsync };
    const f = { getNodeByIdAsync: async () => node } as unknown as typeof figma;

    const result = (await createSetReactionsHandler(f)({
      nodeId: '1:1',
      reactions: [
        {
          trigger: { type: 'ON_CLICK' },
          actions: [{ type: 'NODE', destinationId: '2:2', navigation: 'NAVIGATE' }],
        },
      ],
    })) as MutateResult;

    expect(setReactionsAsync).toHaveBeenCalledWith([
      {
        trigger: { type: 'ON_CLICK' },
        actions: [{ type: 'NODE', destinationId: '2:2', navigation: 'NAVIGATE' }],
      },
    ]);
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it('throws on bad input or unsupported node', async () => {
    await expect(createSetReactionsHandler(withNode({}))({ reactions: [] })).rejects.toThrow(
      /nodeId/,
    );
    await expect(
      createSetReactionsHandler(withNode({}))({ nodeId: '1:1', reactions: 'x' }),
    ).rejects.toThrow(/reactions/);
    await expect(
      createSetReactionsHandler(withNode({ id: '1:1' }))({ nodeId: '1:1', reactions: [] }),
    ).rejects.toThrow(/cannot have reactions/);
  });
});
