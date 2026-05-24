import type { MutateResult } from '@figma-mcp-relay/shared';
import { describe, expect, it } from 'vitest';

import { createSetFillsHandler } from '../../src/handlers/set-fills.js';

const fakeFigma = (lookup: Record<string, unknown>): typeof figma =>
  ({ getNodeByIdAsync: async (id: string) => lookup[id] ?? null }) as unknown as typeof figma;

describe('set_fills handler', () => {
  it('applies SOLID fills to a node and returns ok + nodeId', async () => {
    const node = { id: '1:1', fills: [] as unknown };
    const handler = createSetFillsHandler(fakeFigma({ '1:1': node }));
    const result = (await handler({
      nodeId: '1:1',
      fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0 } }],
    })) as MutateResult;

    expect(node.fills).toEqual([
      { type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1, visible: true },
    ]);
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it('applies a gradient fill (stops + transform round-trip into a GradientPaint)', async () => {
    const node = { id: '1:1', fills: [] as unknown };
    const handler = createSetFillsHandler(fakeFigma({ '1:1': node }));
    const gradient = {
      type: 'GRADIENT_LINEAR',
      visible: true,
      opacity: 1,
      gradientStops: [
        { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
        { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
      ],
      gradientTransform: [
        [1, 0, 0],
        [0, 1, 0],
      ],
    };
    await handler({ nodeId: '1:1', fills: [gradient] });
    expect(node.fills).toEqual([
      {
        type: 'GRADIENT_LINEAR',
        gradientStops: [
          { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
          { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
        ],
        gradientTransform: [
          [1, 0, 0],
          [0, 1, 0],
        ],
        opacity: 1,
        visible: true,
      },
    ]);
  });

  it('throws on a malformed gradient, IMAGE paint, missing node, or bad input', async () => {
    const node = { id: '1:1', fills: [] as unknown };
    const handler = createSetFillsHandler(fakeFigma({ '1:1': node }));
    await expect(
      handler({ nodeId: '1:1', fills: [{ type: 'GRADIENT_LINEAR', visible: true, opacity: 1 }] }),
    ).rejects.toThrow(/gradientStops/);
    await expect(
      handler({ nodeId: '1:1', fills: [{ type: 'IMAGE', visible: true, opacity: 1 }] }),
    ).rejects.toThrow(/unsupported paint type IMAGE/);
    await expect(handler({ nodeId: '9:9', fills: [] })).rejects.toThrow(/not found/);
    await expect(handler({ fills: [] })).rejects.toThrow(/nodeId/);
    await expect(handler({ nodeId: '1:1', fills: 'x' })).rejects.toThrow(/fills/);
  });
});
