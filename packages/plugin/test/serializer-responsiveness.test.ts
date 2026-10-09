import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetThrottleForTests } from '../src/cooperative.js';
import { serializeFlatNodes, serializeTrees } from '../src/serializer.js';

describe('native-read time slicing', () => {
  beforeEach(() => {
    resetThrottleForTests();
  });

  it.each([
    ['flat', serializeFlatNodes],
    ['forest', serializeTrees],
  ] as const)(
    'lets the host run during expensive %s reads below the batch size',
    async (_kind, serialize) => {
      let elapsed = 0;
      let reads = 0;
      const clock = vi.spyOn(Date, 'now').mockImplementation(() => elapsed);
      const nodes = Array.from({ length: 32 }, (_, index) => {
        const node = {
          id: `2:${index}`,
          name: `Instance ${index}`,
          type: 'INSTANCE',
          visible: true,
          locked: false,
          x: 0,
          y: 0,
          get width() {
            reads += 1;
            elapsed += 20;
            return 10;
          },
          height: 10,
          parent: null,
          getMainComponentAsync: async () => ({
            id: `3:${index}`,
            name: `Main ${index}`,
            key: `key-${index}`,
            parent: null,
          }),
        };
        return node as unknown as SceneNode;
      });
      const hostTick = new Promise<number>(resolve => setTimeout(() => resolve(reads), 0));
      try {
        const result = await serialize(nodes);
        expect(await hostTick).toBeLessThan(nodes.length);
        expect(result.complete).toBe(true);
        expect(result.nodes.map(node => node.id)).toEqual(nodes.map(node => node.id));
        expect(result.nodes.map(node => node.mainComponent?.id)).toEqual(
          nodes.map((_, index) => `3:${index}`),
        );
      } finally {
        clock.mockRestore();
      }
    },
  );

  it.each([
    ['flat', serializeFlatNodes],
    ['forest', serializeTrees],
  ] as const)('propagates native read errors across %s host yields', async (_kind, serialize) => {
    const failure = new Error('native read failed');
    let elapsed = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => elapsed);
    const nodes = Array.from(
      { length: 4 },
      (_, index) =>
        ({
          id: `2:${index}`,
          name: `Node ${index}`,
          type: 'RECTANGLE',
          visible: true,
          locked: false,
          x: 0,
          y: 0,
          get width() {
            elapsed += 20;
            if (index === 0) throw failure;
            return 10;
          },
          height: 10,
          parent: null,
        }) as unknown as SceneNode,
    );
    try {
      await expect(serialize(nodes)).rejects.toBe(failure);
    } finally {
      clock.mockRestore();
    }
  });
});
