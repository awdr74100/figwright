import type { GetReactionsResult } from '@figma-mcp-relay/shared';
import { describe, expect, it } from 'vitest';

import { createGetReactionsHandler } from '../../src/handlers/get-reactions.js';

const fakeFigma = (lookup: Record<string, BaseNode | null>): typeof figma =>
  ({ getNodeByIdAsync: async (id: string) => lookup[id] ?? null }) as unknown as typeof figma;

describe('get_reactions handler', () => {
  it('serializes trigger + actions (NODE navigate with transition)', async () => {
    const node = {
      id: '1:1',
      reactions: [
        {
          trigger: { type: 'ON_CLICK' },
          actions: [
            {
              type: 'NODE',
              destinationId: '4:1539',
              navigation: 'NAVIGATE',
              transition: { type: 'SMART_ANIMATE', duration: 0.2 },
            },
          ],
        },
      ],
    } as unknown as BaseNode;
    const result = (await createGetReactionsHandler(fakeFigma({ '1:1': node }))({
      nodeId: '1:1',
    })) as GetReactionsResult;
    expect(result.nodeId).toBe('1:1');
    expect(result.reactions[0]?.trigger).toEqual({ type: 'ON_CLICK' });
    expect(result.reactions[0]?.actions[0]).toEqual({
      type: 'NODE',
      destinationId: '4:1539',
      navigation: 'NAVIGATE',
      transition: { type: 'SMART_ANIMATE', duration: 0.2 },
    });
  });

  it('captures timeout triggers, URL actions, and falls back to the deprecated single action', async () => {
    const node = {
      id: '1:2',
      reactions: [
        { trigger: { type: 'AFTER_TIMEOUT', timeout: 3 }, action: { type: 'URL', url: 'https://x.dev' } },
        { trigger: null, actions: [{ type: 'BACK' }] },
      ],
    } as unknown as BaseNode;
    const result = (await createGetReactionsHandler(fakeFigma({ '1:2': node }))({
      nodeId: '1:2',
    })) as GetReactionsResult;
    expect(result.reactions[0]?.trigger).toEqual({ type: 'AFTER_TIMEOUT', timeout: 3 });
    expect(result.reactions[0]?.actions).toEqual([{ type: 'URL', url: 'https://x.dev' }]);
    expect(result.reactions[1]?.trigger).toBeNull();
    expect(result.reactions[1]?.actions).toEqual([{ type: 'BACK' }]);
  });

  it('returns empty reactions for a missing node or a node without reactions', async () => {
    const handler = createGetReactionsHandler(
      fakeFigma({ '1:3': { id: '1:3' } as unknown as BaseNode, missing: null }),
    );
    expect(((await handler({ nodeId: '1:3' })) as GetReactionsResult).reactions).toEqual([]);
    expect(((await handler({ nodeId: 'missing' })) as GetReactionsResult).reactions).toEqual([]);
  });

  it('throws when nodeId is missing or not a string', async () => {
    const handler = createGetReactionsHandler(fakeFigma({}));
    await expect(handler(undefined)).rejects.toThrow(/nodeId/);
    await expect(handler({ nodeId: 1 })).rejects.toThrow(/nodeId/);
  });
});
