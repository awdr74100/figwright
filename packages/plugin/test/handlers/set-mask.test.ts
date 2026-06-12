import type { MutateResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createSetMaskHandler } from '../../src/handlers/set-mask.js';

const fakeFigma = (lookup: Record<string, unknown>): typeof figma =>
  ({ getNodeByIdAsync: async (id: string) => lookup[id] ?? null }) as unknown as typeof figma;

describe('set_mask handler', () => {
  it('enables masking and sets maskType', async () => {
    const node = { id: '1:1', isMask: false, maskType: 'ALPHA' };
    const handler = createSetMaskHandler(fakeFigma({ '1:1': node }));
    const result = (await handler({
      nodeId: '1:1',
      isMask: true,
      maskType: 'LUMINANCE',
    })) as MutateResult;
    expect(node.isMask).toBe(true);
    expect(node.maskType).toBe('LUMINANCE');
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it('disables masking and ignores maskType when off', async () => {
    const node = { id: '1:1', isMask: true, maskType: 'ALPHA' };
    const handler = createSetMaskHandler(fakeFigma({ '1:1': node }));
    await handler({ nodeId: '1:1', isMask: false, maskType: 'GEOMETRY' });
    expect(node.isMask).toBe(false);
    expect(node.maskType).toBe('ALPHA'); // unchanged — maskType only applied when enabling
  });

  it('throws on bad input or a node that cannot be a mask', async () => {
    const handler = createSetMaskHandler(fakeFigma({ '1:1': { id: '1:1', isMask: false } }));
    await expect(handler({ nodeId: '1:1' })).rejects.toThrow(/isMask/);
    await expect(handler({ nodeId: '9:9', isMask: true })).rejects.toThrow(/not found/);
    await expect(handler({ nodeId: '2:2', isMask: true })).rejects.toThrow(/not found/);
  });
});
