import type { BatchNodeResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createAlignNodesHandler } from '../../src/handlers/align-nodes.js';

type Matrix = [[number, number, number], [number, number, number]];

interface FakeNode {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  parent: FakeNode | { id: string; type: 'PAGE'; parent: null } | null;
  layoutMode?: string;
  layoutPositioning?: string;
  readonly relativeTransform: Matrix;
  readonly absoluteTransform: Matrix;
}

const compose = (m: Matrix, n: Matrix): Matrix => [
  [
    m[0][0] * n[0][0] + m[0][1] * n[1][0],
    m[0][0] * n[0][1] + m[0][1] * n[1][1],
    m[0][0] * n[0][2] + m[0][1] * n[1][2] + m[0][2],
  ],
  [
    m[1][0] * n[0][0] + m[1][1] * n[1][0],
    m[1][0] * n[0][1] + m[1][1] * n[1][1],
    m[1][0] * n[0][2] + m[1][1] * n[1][2] + m[1][2],
  ],
];

const PAGE = { id: '0:0', type: 'PAGE' as const, parent: null };

/**
 * A node whose transforms are derived from x / y / rotation and its parent chain, the way Figma
 * derives them — so a write to x moves absoluteTransform and everything under it.
 */
const node = (
  id: string,
  parent: FakeNode['parent'],
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Partial<Pick<FakeNode, 'type' | 'rotation' | 'layoutMode' | 'layoutPositioning'>> = {},
): FakeNode => ({
  id,
  type: 'RECTANGLE',
  x,
  y,
  width,
  height,
  rotation: 0,
  parent,
  ...extra,
  get relativeTransform(): Matrix {
    const r = (this.rotation * Math.PI) / 180;
    return [
      [Math.cos(r), -Math.sin(r), this.x],
      [Math.sin(r), Math.cos(r), this.y],
    ];
  },
  get absoluteTransform(): Matrix {
    const up = this.parent;
    return up !== null && 'absoluteTransform' in up
      ? compose(up.absoluteTransform, this.relativeTransform)
      : this.relativeTransform;
  },
});

/** A plain (non-auto-layout) frame on the page at canvas (100, 50), 400 × 200. */
const frame = (extra: Parameters<typeof node>[6] = {}, id = '0:1'): FakeNode =>
  node(id, PAGE, 100, 50, 400, 200, { type: 'FRAME', layoutMode: 'NONE', ...extra });

const fakeFigma = (...nodes: { id: string }[]): typeof figma => {
  const lookup = Object.fromEntries(nodes.map(n => [n.id, n]));
  return { getNodeByIdAsync: async (id: string) => lookup[id] ?? null } as unknown as typeof figma;
};

const canvasOrigin = (n: FakeNode): [number, number] => [
  n.absoluteTransform[0][2],
  n.absoluteTransform[1][2],
];

describe('align_nodes handler', () => {
  it('centres a node within its parent on both axes', async () => {
    const parent = frame();
    const n = node('1:1', parent, 0, 0, 100, 40);
    const result = (await createAlignNodesHandler(fakeFigma(n))({
      nodeIds: ['1:1'],
      horizontal: 'CENTER',
      vertical: 'CENTER',
    })) as BatchNodeResult;

    expect(n.x).toBeCloseTo(150); // (400-100)/2
    expect(n.y).toBeCloseTo(80); // (200-40)/2
    expect(result).toEqual({ ok: true, affected: ['1:1'] });
  });

  it('aligns to the parent edges', async () => {
    const parent = frame();
    const a = node('1:1', parent, 50, 50, 100, 40);
    const b = node('1:2', parent, 50, 50, 100, 40);
    await createAlignNodesHandler(fakeFigma(a, b))({ nodeIds: ['1:1'], horizontal: 'MAX' });
    await createAlignNodesHandler(fakeFigma(a, b))({ nodeIds: ['1:2'], vertical: 'MAX' });
    expect([a.x, a.y]).toEqual([300, 50]); // right edge flush: 400 - 100
    expect([b.x, b.y]).toEqual([50, 160]); // bottom flush: 200 - 40
  });

  it('leaves an axis alone when it is not asked for', async () => {
    const parent = frame();
    const n = node('1:1', parent, 7, 9, 100, 40);
    await createAlignNodesHandler(fakeFigma(n))({ nodeIds: ['1:1'], horizontal: 'CENTER' });
    expect([n.x, n.y]).toEqual([150, 9]);
  });

  it('aligns a selection to its own bounding box', async () => {
    const parent = frame();
    const a = node('1:1', parent, 10, 10, 50, 20);
    const b = node('1:2', parent, 200, 100, 80, 60);
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

  it('aligns a selection that spans different parents on the canvas', async () => {
    const left = frame({}, '0:1');
    const right = node('0:2', PAGE, 600, 300, 200, 200, { type: 'FRAME', layoutMode: 'NONE' });
    const a = node('1:1', left, 0, 0, 40, 40); // canvas top 50
    const b = node('1:2', right, 0, 20, 40, 40); // canvas top 320
    await createAlignNodesHandler(fakeFigma(a, b))({
      nodeIds: ['1:1', '1:2'],
      vertical: 'MIN',
      relativeTo: 'SELECTION',
    });
    expect(canvasOrigin(a)[1]).toBeCloseTo(50);
    expect(canvasOrigin(b)[1]).toBeCloseTo(50);
    expect(b.y).toBeCloseTo(-250); // 50 canvas = 300 + y
  });

  it('spaces three nodes with equal gaps, keeping the outer two in place', async () => {
    const parent = frame();
    const a = node('1:1', parent, 0, 0, 40, 40);
    const b = node('1:2', parent, 60, 0, 40, 40);
    const c = node('1:3', parent, 300, 0, 40, 40);
    await createAlignNodesHandler(fakeFigma(a, b, c))({
      nodeIds: ['1:1', '1:2', '1:3'],
      distribute: 'HORIZONTAL',
    });
    // span 340, nodes 120, two gaps of 110
    expect([a.x, b.x, c.x]).toEqual([0, 150, 300]);
  });

  it('distributes by position, not by the order the ids were passed', async () => {
    const parent = frame();
    const a = node('1:1', parent, 0, 0, 40, 40);
    const b = node('1:2', parent, 60, 0, 40, 40);
    const c = node('1:3', parent, 300, 0, 40, 40);
    await createAlignNodesHandler(fakeFigma(a, b, c))({
      nodeIds: ['1:3', '1:1', '1:2'],
      distribute: 'HORIZONTAL',
    });
    expect([a.x, b.x, c.x]).toEqual([0, 150, 300]);
  });

  it('distributes on one axis while centring each node in its parent on the other', async () => {
    const parent = frame();
    const a = node('1:1', parent, 0, 0, 40, 40);
    const b = node('1:2', parent, 60, 10, 40, 40);
    const c = node('1:3', parent, 300, 150, 40, 40);
    await createAlignNodesHandler(fakeFigma(a, b, c))({
      nodeIds: ['1:1', '1:2', '1:3'],
      distribute: 'HORIZONTAL',
      vertical: 'CENTER',
    });
    expect([a.x, b.x, c.x]).toEqual([0, 150, 300]);
    expect([a.y, b.y, c.y]).toEqual([80, 80, 80]); // (200-40)/2 in the parent, not the selection
  });

  it("aligns to a rotated parent's own edges, leaving the other axis alone", async () => {
    const rotated = frame({ rotation: 30 });
    const n = node('1:1', rotated, 80, 30, 40, 40);
    await createAlignNodesHandler(fakeFigma(n))({ nodeIds: ['1:1'], horizontal: 'MIN' });
    expect(n.x).toBeCloseTo(0);
    expect(n.y).toBeCloseTo(30);
  });

  it('centres a rotated node by what it covers in the parent', async () => {
    const parent = frame();
    // A 100×100 square turned 45° about its origin covers x ∈ [-70.7, 70.7] in the parent.
    const n = node('1:1', parent, 0, 0, 100, 100, { rotation: 45 });
    await createAlignNodesHandler(fakeFigma(n))({ nodeIds: ['1:1'], horizontal: 'CENTER' });
    expect(n.x).toBeCloseTo(200); // its covered span is centred on the parent's x = 200
  });

  it('moves a node once even when its id is passed twice', async () => {
    const parent = frame();
    const n = node('1:1', parent, 10, 10, 40, 40);
    const result = (await createAlignNodesHandler(fakeFigma(n))({
      nodeIds: ['1:1', '1:1'],
      horizontal: 'CENTER',
    })) as BatchNodeResult;
    expect(n.x).toBe(180);
    expect(result.affected).toEqual(['1:1']);
  });

  it('refuses a node whose ancestor is also being aligned, moving nothing', async () => {
    const parent = frame();
    const inner = node('1:1', parent, 200, 150, 100, 100, { type: 'FRAME', layoutMode: 'NONE' });
    const nested = node('1:2', inner, -50, 0, 20, 20);
    await expect(
      createAlignNodesHandler(fakeFigma(inner, nested))({
        nodeIds: ['1:1', '1:2'],
        horizontal: 'MIN',
        relativeTo: 'SELECTION',
      }),
    ).rejects.toThrow(/inside 1:1, which is also being aligned/);
    expect([inner.x, nested.x]).toEqual([200, -50]);
  });

  it('refuses a sublayer of an instance before moving anything', async () => {
    const parent = frame();
    const free = node('1:1', parent, 0, 0, 10, 10);
    const instance = node('2:1', parent, 100, 0, 50, 50, { type: 'INSTANCE' });
    const sub = node('I2:1;3:1', instance, 5, 5, 10, 10);
    await expect(
      createAlignNodesHandler(fakeFigma(free, sub))({
        nodeIds: ['1:1', 'I2:1;3:1'],
        horizontal: 'MAX',
      }),
    ).rejects.toThrow(/inside instance 2:1/);
    expect(free.x).toBe(0);
  });

  it('puts back the nodes it already moved when a later write throws', async () => {
    const parent = frame();
    const a = node('1:1', parent, 0, 0, 10, 10);
    const b = node('1:2', parent, 0, 20, 10, 10);
    Object.defineProperty(b, 'x', {
      get: () => 0,
      set: () => {
        throw new Error('locked by the editor');
      },
    });
    await expect(
      createAlignNodesHandler(fakeFigma(a, b))({ nodeIds: ['1:1', '1:2'], horizontal: 'MAX' }),
    ).rejects.toThrow(/locked by the editor/);
    expect(a.x).toBe(0);
  });

  it('refuses an in-flow auto-layout child and moves nothing, even other nodes', async () => {
    const free = frame();
    const flow = frame({ layoutMode: 'VERTICAL' }, '0:2');
    const ok = node('1:1', free, 0, 0, 100, 40);
    const stuck = node('1:2', flow, 0, 0, 100, 40, { layoutPositioning: 'AUTO' });
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
    const n = node('1:1', flow, 0, 0, 100, 40, { layoutPositioning: 'ABSOLUTE' });
    await createAlignNodesHandler(fakeFigma(n))({ nodeIds: ['1:1'], horizontal: 'CENTER' });
    expect(n.x).toBe(150);
  });

  it('refuses PARENT alignment for a node on a page, pointing at SELECTION', async () => {
    const n = node('1:1', PAGE, 0, 0, 10, 10);
    await expect(
      createAlignNodesHandler(fakeFigma(n))({ nodeIds: ['1:1'], horizontal: 'CENTER' }),
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
      handler({ nodeIds: ['1:1', '1:1', '1:2'], distribute: 'HORIZONTAL' }),
    ).rejects.toThrow(/at least 3 distinct/);
    await expect(
      handler({ nodeIds: ['1:1', '1:2', '1:3'], distribute: 'HORIZONTAL', horizontal: 'MIN' }),
    ).rejects.toThrow(/same axis/);
    await expect(handler({ nodeIds: ['9:9'], horizontal: 'MIN' })).rejects.toThrow(/not found/);
  });

  it('refuses a node with no position', async () => {
    await expect(
      createAlignNodesHandler(fakeFigma(PAGE))({ nodeIds: ['0:0'], horizontal: 'MIN' }),
    ).rejects.toThrow(/no position to align/);
  });
});
