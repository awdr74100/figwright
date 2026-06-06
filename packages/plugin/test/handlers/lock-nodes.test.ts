import type { BatchNodeResult } from '@figma-mcp-relay/shared';
import { describe, expect, it } from 'vitest';

import { createSetLockedHandler } from '../../src/handlers/lock-nodes.js';

const fakeFigma = (lookup: Record<string, unknown>): typeof figma =>
  ({ getNodeByIdAsync: async (id: string) => lookup[id] ?? null }) as unknown as typeof figma;

describe('lock/unlock nodes handler', () => {
  it('locks lockable nodes (locked=true) and skips the rest', async () => {
    const a = { id: '1:1', locked: false };
    const noLock = { id: '1:2' };
    const handler = createSetLockedHandler(fakeFigma({ '1:1': a, '1:2': noLock }), true);
    const result = (await handler({ nodeIds: ['1:1', '1:2', '9:9'] })) as BatchNodeResult;
    expect(a.locked).toBe(true);
    expect(result).toEqual({ ok: true, affected: ['1:1'] });
  });

  it('unlocks nodes (locked=false)', async () => {
    const a = { id: '1:1', locked: true };
    const handler = createSetLockedHandler(fakeFigma({ '1:1': a }), false);
    await handler({ nodeIds: ['1:1'] });
    expect(a.locked).toBe(false);
  });

  it('throws on bad input (message reflects lock vs unlock)', async () => {
    await expect(createSetLockedHandler(fakeFigma({}), true)({ nodeIds: 'x' })).rejects.toThrow(
      /lock_nodes/,
    );
    await expect(createSetLockedHandler(fakeFigma({}), false)({ nodeIds: 'x' })).rejects.toThrow(
      /unlock_nodes/,
    );
  });
});
