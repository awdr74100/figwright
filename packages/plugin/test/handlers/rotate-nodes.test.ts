import type { BatchNodeResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createRotateNodesHandler } from '../../src/handlers/rotate-nodes.js';

const fakeFigma = (lookup: Record<string, unknown>): typeof figma =>
  ({ getNodeByIdAsync: async (id: string) => lookup[id] ?? null }) as unknown as typeof figma;

describe('rotate_nodes handler', () => {
  it('sets rotation on nodes that support it and skips the rest', async () => {
    const a = { id: '1:1', rotation: 0 };
    const noRot = { id: '1:2' };
    const handler = createRotateNodesHandler(fakeFigma({ '1:1': a, '1:2': noRot }));
    const result = (await handler({
      nodeIds: ['1:1', '1:2', '9:9'],
      rotation: 45,
    })) as BatchNodeResult;
    expect(a.rotation).toBe(45);
    expect(result).toEqual({ ok: true, affected: ['1:1'] });
  });

  it('throws on bad input', async () => {
    const handler = createRotateNodesHandler(fakeFigma({}));
    await expect(handler({ nodeIds: ['1:1'] })).rejects.toThrow(/rotation/);
    await expect(handler({ nodeIds: 'x', rotation: 1 })).rejects.toThrow(/nodeIds/);
  });
});
