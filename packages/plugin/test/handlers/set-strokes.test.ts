import type { MutateResult } from '@figma-mcp-relay/shared';
import { describe, expect, it } from 'vitest';

import { createSetStrokesHandler } from '../../src/handlers/set-strokes.js';

const fakeFigma = (lookup: Record<string, unknown>): typeof figma =>
  ({ getNodeByIdAsync: async (id: string) => lookup[id] ?? null }) as unknown as typeof figma;

describe('set_strokes handler', () => {
  it('applies SOLID strokes and strokeWeight', async () => {
    const node = { id: '1:1', strokes: [] as unknown, strokeWeight: 0 };
    const handler = createSetStrokesHandler(fakeFigma({ '1:1': node }));
    const result = (await handler({
      nodeId: '1:1',
      strokes: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 0 } }],
      strokeWeight: 2,
    })) as MutateResult;

    expect(node.strokes).toEqual([
      { type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1, visible: true },
    ]);
    expect(node.strokeWeight).toBe(2);
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it('applies strokeAlign, dashPattern, and per-side weights', async () => {
    const node = {
      id: '1:1',
      strokes: [] as unknown,
      strokeWeight: 0,
      strokeAlign: 'CENTER',
      dashPattern: [] as readonly number[],
      strokeTopWeight: 0,
      strokeRightWeight: 0,
      strokeBottomWeight: 0,
      strokeLeftWeight: 0,
    };
    await createSetStrokesHandler(fakeFigma({ '1:1': node }))({
      nodeId: '1:1',
      strokes: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 0 } }],
      strokeWeight: 1,
      strokeAlign: 'INSIDE',
      dashPattern: [4, 2],
      strokeBottomWeight: 2,
    });

    expect(node.strokeAlign).toBe('INSIDE');
    expect(node.dashPattern).toEqual([4, 2]);
    // uniform weight applied, then the per-side override wins for the bottom edge
    expect(node.strokeBottomWeight).toBe(2);
    expect(node.strokeTopWeight).toBe(0);
  });

  it('throws when per-side weights target a node that lacks them', async () => {
    const handler = createSetStrokesHandler(fakeFigma({ '1:1': { id: '1:1', strokes: [] } }));
    await expect(handler({ nodeId: '1:1', strokes: [], strokeBottomWeight: 2 })).rejects.toThrow(
      /per-side/,
    );
  });

  it('rejects non-array strokes, non-SOLID paint, bad weight, and missing nodes', async () => {
    const handler = createSetStrokesHandler(fakeFigma({ '1:1': { id: '1:1', strokes: [] } }));
    await expect(handler({ nodeId: '1:1', strokes: 'x' })).rejects.toThrow(/strokes/);
    await expect(
      handler({ nodeId: '1:1', strokes: [{ type: 'IMAGE', visible: true, opacity: 1 }] }),
    ).rejects.toThrow(/SOLID/);
    await expect(handler({ nodeId: '1:1', strokes: [], strokeWeight: -1 })).rejects.toThrow(
      /strokeWeight/,
    );
    await expect(handler({ nodeId: '9:9', strokes: [] })).rejects.toThrow(/not found/);
  });
});
