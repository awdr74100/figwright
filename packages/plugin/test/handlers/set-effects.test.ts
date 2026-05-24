import type { MutateResult } from '@figma-mcp-relay/shared';
import { describe, expect, it } from 'vitest';

import { createSetEffectsHandler } from '../../src/handlers/set-effects.js';

const fakeFigma = (lookup: Record<string, unknown>): typeof figma =>
  ({ getNodeByIdAsync: async (id: string) => lookup[id] ?? null }) as unknown as typeof figma;

const dropShadow = {
  type: 'DROP_SHADOW',
  visible: true,
  radius: 4,
  color: { r: 0, g: 0, b: 0, a: 0.25 },
  offset: { x: 0, y: 2 },
  spread: 0,
};

describe('set_effects handler', () => {
  it('applies effects to a node and returns ok + nodeId', async () => {
    const node = { id: '1:1', effects: [] as unknown };
    const handler = createSetEffectsHandler(fakeFigma({ '1:1': node }));
    const result = (await handler({ nodeId: '1:1', effects: [dropShadow] })) as MutateResult;

    expect(node.effects).toEqual([
      {
        type: 'DROP_SHADOW',
        visible: true,
        radius: 4,
        color: { r: 0, g: 0, b: 0, a: 0.25 },
        offset: { x: 0, y: 2 },
        spread: 0,
        blendMode: 'NORMAL',
      },
    ]);
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it('throws on missing node, bad input, or shadow without color/offset', async () => {
    const node = { id: '1:1', effects: [] as unknown };
    const handler = createSetEffectsHandler(fakeFigma({ '1:1': node }));
    await expect(handler({ nodeId: '9:9', effects: [] })).rejects.toThrow(/not found/);
    await expect(handler({ effects: [] })).rejects.toThrow(/nodeId/);
    await expect(handler({ nodeId: '1:1', effects: 'x' })).rejects.toThrow(/effects/);
    await expect(
      handler({ nodeId: '1:1', effects: [{ type: 'DROP_SHADOW', visible: true }] }),
    ).rejects.toThrow(/color and offset/);
  });
});
