import { describe, expect, it } from 'vitest';

import { createFlipNodesHandler, flipped } from '../../src/handlers/flip-nodes.js';
import { orientationOf } from '../../src/orientation.js';

const apply = ([[a, c, e], [b, d, f]]: Transform, x: number, y: number) => [
  a * x + c * y + e,
  b * x + d * y + f,
];
const close = (m: Transform, n: Transform) =>
  m.forEach((row, i) => row.forEach((v, j) => expect(v).toBeCloseTo(n[i]![j]!, 9)));

describe('flip_nodes', () => {
  const turned: Transform = [
    [Math.cos(0.5), Math.sin(0.5), 40],
    [-Math.sin(0.5), Math.cos(0.5), 90],
  ];

  it.each(['HORIZONTAL', 'VERTICAL'] as const)(
    'mirrors %s about the node’s centre, which stays put',
    axis => {
      const m = flipped(turned, 120, 30, axis);
      const [cx, cy] = apply(turned, 60, 15);
      const [nx, ny] = apply(m, 60, 15);
      expect(nx).toBeCloseTo(cx!, 9);
      expect(ny).toBeCloseTo(cy!, 9);
      expect(orientationOf(m).flipped).toBe(true);
      // Twice is the original.
      close(flipped(m, 120, 30, axis), turned);
    },
  );

  it('swaps left and right on the canvas, top and bottom', () => {
    const upright: Transform = [
      [1, 0, 10],
      [0, 1, 20],
    ];
    // HORIZONTAL: the left edge (x 10) is now where the right edge was (x 110).
    expect(apply(flipped(upright, 100, 50, 'HORIZONTAL'), 0, 0)).toEqual([110, 20]);
    expect(apply(flipped(upright, 100, 50, 'VERTICAL'), 0, 0)).toEqual([10, 70]);
  });

  it('flips every node or, naming the ones it cannot, none', async () => {
    const node = {
      id: 'a',
      width: 10,
      height: 10,
      relativeTransform: [
        [1, 0, 0],
        [0, 1, 0],
      ] as Transform,
    };
    const ctx = {
      getNodeByIdAsync: async (id: string) => (id === 'a' ? node : id === 'p' ? { id } : null),
    } as unknown as typeof figma;
    await expect(
      createFlipNodesHandler(ctx)({ nodeIds: ['a', 'p', 'gone'], axis: 'HORIZONTAL' }),
    ).rejects.toThrow('flip_nodes: p, gone not found or cannot be flipped');
    expect(node.relativeTransform).toEqual([
      [1, 0, 0],
      [0, 1, 0],
    ]);
    await createFlipNodesHandler(ctx)({ nodeIds: ['a'], axis: 'HORIZONTAL' });
    expect(node.relativeTransform).toEqual([
      [-1, -0, 10],
      [0, 1, 0],
    ]);
  });

  it('refuses a layer inside an instance before flipping anything', async () => {
    const node = {
      id: 'a',
      width: 10,
      height: 10,
      relativeTransform: [
        [1, 0, 0],
        [0, 1, 0],
      ] as Transform,
    };
    const layer = {
      id: 'I1:2;3:4',
      width: 5,
      height: 5,
      relativeTransform: [
        [1, 0, 0],
        [0, 1, 0],
      ] as Transform,
    };
    const nodes: Record<string, unknown> = { a: node, 'I1:2;3:4': layer };
    const ctx = {
      getNodeByIdAsync: async (id: string) => nodes[id] ?? null,
    } as unknown as typeof figma;
    await expect(
      createFlipNodesHandler(ctx)({ nodeIds: ['a', 'I1:2;3:4'], axis: 'VERTICAL' }),
    ).rejects.toThrow('I1:2;3:4 is inside an instance, which cannot override a layer’s transform');
    expect(node.relativeTransform).toEqual([
      [1, 0, 0],
      [0, 1, 0],
    ]);
  });
});
