import type { MutateResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createSetOpacityHandler } from '../../src/handlers/set-opacity.js';

const fakeFigma = (lookup: Record<string, unknown>): typeof figma =>
  ({ getNodeByIdAsync: async (id: string) => lookup[id] ?? null }) as unknown as typeof figma;

describe('set_opacity handler', () => {
  it('sets opacity and returns ok + nodeId', async () => {
    const node = { id: '1:1', opacity: 1 };
    const handler = createSetOpacityHandler(fakeFigma({ '1:1': node }));
    const result = (await handler({ nodeId: '1:1', opacity: 0.5 })) as MutateResult;
    expect(node.opacity).toBe(0.5);
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it('rejects out-of-range opacity, bad input, and missing nodes', async () => {
    const handler = createSetOpacityHandler(fakeFigma({ '1:1': { id: '1:1', opacity: 1 } }));
    await expect(handler({ nodeId: '1:1', opacity: 2 })).rejects.toThrow(/opacity/);
    await expect(handler({ nodeId: '1:1' })).rejects.toThrow(/opacity/);
    await expect(handler({ opacity: 0.5 })).rejects.toThrow(/nodeId/);
    await expect(handler({ nodeId: '9:9', opacity: 0.5 })).rejects.toThrow(/not found/);
  });
});
