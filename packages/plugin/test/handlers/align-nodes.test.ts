import type { BatchNodeResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createAlignNodesHandler } from '../../src/handlers/align-nodes.js';

interface FakeNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  absoluteBoundingBox: { x: number; y: number; width: number; height: number } | null;
  parent: unknown;
  layoutPositioning?: string;
}

/** A plain (non-auto-layout) frame at canvas (100, 50), 400 × 200. */
const frame = (overrides: Record<string, unknown> = {}) => ({
  id: '0:1',
  layoutMode: 'NONE',
  absoluteTransform: [
    [1, 0, 100],
    [0, 1, 50],
  ],
  absoluteBoundingBox: { x: 100, y: 50, width: 400, height: 200 },
  ...overrides,
});

/** A child whose x/y are parent-relative; its canvas box is derived from the parent's origin. */
const child = (
  id: string,
  parent: ReturnType<typeof frame>,
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Partial<FakeNode> = {},
): FakeNode => ({
  id,
  x,
  y,
  width,
  height,
  absoluteBoundingBox: {
    x: parent.absoluteBoundingBox.x + x,
    y: parent.absoluteBoundingBox.y + y,
    width,
    height,
  },
  parent,
  ...extra,
});

const fakeFigma = (...nodes: { id: string }[]): typeof figma => {
  const lookup = Object.fromEntries(nodes.map(n => [n.id, n]));
  return { getNodeByIdAsync: async (id: string) => lookup[id] ?? null } as unknown as typeof figma;
};

describe('align_nodes handler', () => {
  it('centres a node within its parent on both axes', async () => {
    const parent = frame();
    const node = child('1:1', parent, 0, 0, 100, 40);
    const result = (await createAlignNodesHandler(fakeFigma(node))({
      nodeIds: ['1:1'],
      horizontal: 'CENTER',
      vertical: 'CENTER',
    })) as BatchNodeResult;

    expect(node).toMatchObject({ x: 150, y: 80 }); // (400-100)/2, (200-40)/2
    expect(result).toEqual({ ok: true, affected: ['1:1'] });
  });

  it('aligns to the parent edges', async () => {
    const parent = frame();
    const a = child('1:1', parent, 50, 50, 100, 40);
    const b = child('1:2', parent, 50, 50, 100, 40);
    await createAlignNodesHandler(fakeFigma(a, b))({ nodeIds: ['1:1'], horizontal: 'MAX' });
    await createAlignNodesHandler(fakeFigma(a, b))({ nodeIds: ['1:2'], vertical: 'MAX' });
    expect(a).toMatchObject({ x: 300, y: 50 }); // right edge flush: 400 - 100
    expect(b).toMatchObject({ x: 50, y: 160 }); // bottom flush: 200 - 40
  });

  it('leaves an axis alone when it is not asked for', async () => {
    const parent = frame();
    const node = child('1:1', parent, 7, 9, 100, 40);
    await createAlignNodesHandler(fakeFigma(node))({ nodeIds: ['1:1'], horizontal: 'CENTER' });
    expect(node).toMatchObject({ x: 150, y: 9 });
  });

  it('aligns a selection to its own bounding box', async () => {
    const parent = frame();
    const a = child('1:1', parent, 10, 10, 50, 20);
    const b = child('1:2', parent, 200, 100, 80, 60);
    await createAlignNodesHandler(fakeFigma(a, b))({
      nodeIds: ['1:1', '1:2'],
      vertical: 'CENTER',
      relativeTo: 'SELECTION',
    });
    // union spans y 10..160 (centre 85): a centres at 85, b at 85
    expect(a.y).toBe(75);
    expect(b.y).toBe(55);
    expect(a.x).toBe(10); // horizontal untouched
  });

  it('spaces three nodes with equal gaps, keeping the outer two in place', async () => {
    const parent = frame();
    const a = child('1:1', parent, 0, 0, 40, 40);
    const b = child('1:2', parent, 60, 0, 40, 40);
    const c = child('1:3', parent, 300, 0, 40, 40);
    await createAlignNodesHandler(fakeFigma(a, b, c))({
      nodeIds: ['1:1', '1:2', '1:3'],
      distribute: 'HORIZONTAL',
    });
    // span 340, nodes 120, two gaps of 110
    expect([a.x, b.x, c.x]).toEqual([0, 150, 300]);
  });

  it('distributes by position, not by the order the ids were passed', async () => {
    const parent = frame();
    const a = child('1:1', parent, 0, 0, 40, 40);
    const b = child('1:2', parent, 60, 0, 40, 40);
    const c = child('1:3', parent, 300, 0, 40, 40);
    await createAlignNodesHandler(fakeFigma(a, b, c))({
      nodeIds: ['1:3', '1:1', '1:2'],
      distribute: 'HORIZONTAL',
    });
    expect([a.x, b.x, c.x]).toEqual([0, 150, 300]);
  });

  it('applies the canvas delta correctly under a rotated parent', async () => {
    // 90° rotation: parent-space +x runs down the canvas. Moving the node 30 canvas-units right
    // therefore means changing its parent-space y.
    const rotated = frame({
      absoluteTransform: [
        [0, -1, 100],
        [1, 0, 50],
      ],
    });
    const node = {
      id: '1:1',
      x: 0,
      y: 0,
      absoluteBoundingBox: { x: 70, y: 50, width: 10, height: 10 },
      parent: rotated,
    };
    await createAlignNodesHandler(fakeFigma(node))({
      nodeIds: ['1:1'],
      horizontal: 'MIN', // to the parent's left edge at canvas x 100 → +30 canvas x
      relativeTo: 'PARENT',
    });
    expect(node.x).toBeCloseTo(0);
    expect(node.y).toBeCloseTo(-30);
  });

  it('refuses an in-flow auto-layout child and moves nothing, even other nodes', async () => {
    const free = frame();
    const flow = frame({ id: '0:2', layoutMode: 'VERTICAL' });
    const ok = child('1:1', free, 0, 0, 100, 40);
    const stuck = child('1:2', flow, 0, 0, 100, 40, { layoutPositioning: 'AUTO' });
    await expect(
      createAlignNodesHandler(fakeFigma(ok, stuck))({
        nodeIds: ['1:1', '1:2'],
        horizontal: 'CENTER',
      }),
    ).rejects.toThrow(/in-flow child.*layoutAlign/s);
    expect(ok.x).toBe(0); // validated up front
  });

  it('allows an ABSOLUTE child of an auto-layout frame', async () => {
    const flow = frame({ layoutMode: 'HORIZONTAL' });
    const node = child('1:1', flow, 0, 0, 100, 40, { layoutPositioning: 'ABSOLUTE' });
    await createAlignNodesHandler(fakeFigma(node))({ nodeIds: ['1:1'], horizontal: 'CENTER' });
    expect(node.x).toBe(150);
  });

  it('refuses PARENT alignment for a node on a page, pointing at SELECTION', async () => {
    const node = {
      id: '1:1',
      x: 0,
      y: 0,
      absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
      parent: { type: 'PAGE' },
    };
    await expect(
      createAlignNodesHandler(fakeFigma(node))({ nodeIds: ['1:1'], horizontal: 'CENTER' }),
    ).rejects.toThrow(/relativeTo SELECTION/);
  });

  it('rejects bad input', async () => {
    const handler = createAlignNodesHandler(fakeFigma());
    await expect(handler({})).rejects.toThrow(/nodeIds/);
    await expect(handler({ nodeIds: [] })).rejects.toThrow(/nodeIds/);
    await expect(handler({ nodeIds: ['1:1'] })).rejects.toThrow(/horizontal, vertical and\/or/);
    await expect(handler({ nodeIds: ['1:1'], horizontal: 'LEFT' })).rejects.toThrow(
      /MIN, CENTER or MAX/,
    );
    await expect(handler({ nodeIds: ['1:1'], horizontal: 'MIN', relativeTo: 'X' })).rejects.toThrow(
      /relativeTo/,
    );
    await expect(handler({ nodeIds: ['1:1', '1:2'], distribute: 'HORIZONTAL' })).rejects.toThrow(
      /at least 3/,
    );
    await expect(
      handler({ nodeIds: ['1:1', '1:2', '1:3'], distribute: 'HORIZONTAL', horizontal: 'MIN' }),
    ).rejects.toThrow(/same axis/);
    await expect(handler({ nodeIds: ['9:9'], horizontal: 'MIN' })).rejects.toThrow(/not found/);
  });

  it('refuses a node that has no bounds', async () => {
    const node = { id: '1:1', x: 0, y: 0, absoluteBoundingBox: null, parent: frame() };
    await expect(
      createAlignNodesHandler(fakeFigma(node))({ nodeIds: ['1:1'], horizontal: 'MIN' }),
    ).rejects.toThrow(/no bounds/);
  });
});
