import type { MutateResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createSetVisibleHandler } from '../../src/handlers/set-visible.js';

const fakeFigma = (lookup: Record<string, unknown>): typeof figma =>
  ({ getNodeByIdAsync: async (id: string) => lookup[id] ?? null }) as unknown as typeof figma;

describe('set_visible handler', () => {
  it('toggles visibility and returns ok + nodeId', async () => {
    const node = { id: '1:1', visible: true };
    const handler = createSetVisibleHandler(fakeFigma({ '1:1': node }));
    const result = (await handler({ nodeId: '1:1', visible: false })) as MutateResult;
    expect(node.visible).toBe(false);
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it('rejects non-boolean visible, bad input, and missing nodes', async () => {
    const handler = createSetVisibleHandler(fakeFigma({ '1:1': { id: '1:1', visible: true } }));
    await expect(handler({ nodeId: '1:1', visible: 'yes' })).rejects.toThrow(/visible/);
    await expect(handler({ visible: true })).rejects.toThrow(/nodeId/);
    await expect(handler({ nodeId: '9:9', visible: true })).rejects.toThrow(/not found/);
  });
});
