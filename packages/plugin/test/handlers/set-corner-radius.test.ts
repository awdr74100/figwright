import type { MutateResult } from '@figma-mcp-relay/shared';
import { describe, expect, it } from 'vitest';

import { createSetCornerRadiusHandler } from '../../src/handlers/set-corner-radius.js';

const fakeFigma = (lookup: Record<string, unknown>): typeof figma =>
  ({ getNodeByIdAsync: async (id: string) => lookup[id] ?? null }) as unknown as typeof figma;

describe('set_corner_radius handler', () => {
  it('sets the corner radius', async () => {
    const node = { id: '1:1', cornerRadius: 0 };
    const handler = createSetCornerRadiusHandler(fakeFigma({ '1:1': node }));
    const result = (await handler({ nodeId: '1:1', radius: 12 })) as MutateResult;
    expect(node.cornerRadius).toBe(12);
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it('sets per-corner radii, overriding the uniform radius for given corners', async () => {
    const node = {
      id: '1:1',
      cornerRadius: 0,
      topLeftRadius: 0,
      topRightRadius: 0,
      bottomRightRadius: 0,
      bottomLeftRadius: 0,
    };
    const handler = createSetCornerRadiusHandler(fakeFigma({ '1:1': node }));
    const result = (await handler({
      nodeId: '1:1',
      radius: 4,
      topLeftRadius: 8,
      topRightRadius: 8,
    })) as MutateResult;
    expect(node.cornerRadius).toBe(4); // uniform applied first
    expect(node.topLeftRadius).toBe(8); // per-corner overrides
    expect(node.topRightRadius).toBe(8);
    expect(node.bottomRightRadius).toBe(0); // untouched corners keep uniform
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it('accepts per-corner only (no uniform radius)', async () => {
    const node = { id: '1:1', cornerRadius: 0, bottomLeftRadius: 0 };
    const handler = createSetCornerRadiusHandler(fakeFigma({ '1:1': node }));
    await handler({ nodeId: '1:1', bottomLeftRadius: 12 });
    expect(node.bottomLeftRadius).toBe(12);
  });

  it('rejects negative radius, bad input, and nodes without cornerRadius', async () => {
    const handler = createSetCornerRadiusHandler(
      fakeFigma({ '1:1': { id: '1:1', cornerRadius: 0 } }),
    );
    await expect(handler({ nodeId: '1:1', radius: -1 })).rejects.toThrow(/radius/);
    await expect(handler({ nodeId: '1:1', topLeftRadius: -1 })).rejects.toThrow(/radius/);
    await expect(handler({ nodeId: '1:1' })).rejects.toThrow(/radius/);
    await expect(handler({ nodeId: '9:9', radius: 4 })).rejects.toThrow(/not found/);
  });

  it('rejects per-corner radii on a node that lacks individual corners', async () => {
    const handler = createSetCornerRadiusHandler(
      fakeFigma({ '1:1': { id: '1:1', cornerRadius: 0 } }),
    );
    await expect(handler({ nodeId: '1:1', topLeftRadius: 8 })).rejects.toThrow(/per-corner/);
  });
});
