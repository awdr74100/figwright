import type { MutateResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createSetBlendModeHandler } from '../../src/handlers/set-blend-mode.js';

const fakeFigma = (lookup: Record<string, unknown>): typeof figma =>
  ({ getNodeByIdAsync: async (id: string) => lookup[id] ?? null }) as unknown as typeof figma;

describe('set_blend_mode handler', () => {
  it('sets the blend mode', async () => {
    const node = { id: '1:1', blendMode: 'NORMAL' };
    const handler = createSetBlendModeHandler(fakeFigma({ '1:1': node }));
    const result = (await handler({ nodeId: '1:1', blendMode: 'MULTIPLY' })) as MutateResult;
    expect(node.blendMode).toBe('MULTIPLY');
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it('throws on bad input or missing node', async () => {
    const handler = createSetBlendModeHandler(
      fakeFigma({ '1:1': { id: '1:1', blendMode: 'NORMAL' } }),
    );
    await expect(handler({ nodeId: '1:1' })).rejects.toThrow(/blendMode/);
    await expect(handler({ nodeId: '9:9', blendMode: 'SCREEN' })).rejects.toThrow(/not found/);
  });
});
