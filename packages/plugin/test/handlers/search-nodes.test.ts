import type { SearchNodesResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createSearchNodesHandler } from '../../src/handlers/search-nodes.js';

const fake = (id: string, type: string, name: string, children?: SceneNode[]): SceneNode =>
  ({
    id,
    name,
    type,
    visible: true,
    locked: false,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    parent: { id: 'root' },
    children,
  }) as unknown as SceneNode;

const fakeFigma = (
  pageChildren: SceneNode[],
  lookup: Record<string, BaseNode | null> = {},
): typeof figma =>
  ({
    currentPage: { children: pageChildren },
    getNodeByIdAsync: async (id: string) => lookup[id] ?? null,
  }) as unknown as typeof figma;

const tree = (): SceneNode[] => [
  fake('1:1', 'FRAME', 'Login Card', [
    fake('1:2', 'TEXT', 'Submit Button Label'),
    fake('1:3', 'RECTANGLE', 'submit bg'),
  ]),
  fake('1:4', 'TEXT', 'Footer'),
];

describe('search_nodes handler', () => {
  it('yields while searching expensive native names even when no nodes match', async () => {
    let elapsed = 0;
    let visited = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => elapsed);
    const nodes = Array.from({ length: 256 }, (_, index) => {
      const node = fake(`7:${index}`, 'INSTANCE', 'Other');
      Object.defineProperty(node, 'name', {
        get: () => {
          visited += 1;
          elapsed += 20;
          return 'Other';
        },
      });
      return node;
    });
    const hostTick = new Promise<number>(resolve => setTimeout(() => resolve(visited), 0));
    try {
      const result = (await createSearchNodesHandler(fakeFigma(nodes))({
        name: 'IconPlaceholder',
        type: 'INSTANCE',
      })) as SearchNodesResult;
      expect(await hostTick).toBeLessThan(nodes.length);
      expect(result.nodes).toEqual([]);
      expect(visited).toBe(nodes.length);
    } finally {
      clock.mockRestore();
    }
  });

  it('does not read names of nodes excluded by the requested type', async () => {
    const node = fake('7:1', 'VECTOR', 'Vector');
    Object.defineProperty(node, 'name', {
      get: () => {
        throw new Error('excluded native name must not be read');
      },
    });
    const result = (await createSearchNodesHandler(fakeFigma([node]))({
      name: 'IconPlaceholder',
      type: 'INSTANCE',
    })) as SearchNodesResult;
    expect(result.nodes).toEqual([]);
  });

  it('matches by case-insensitive name substring across the whole page', async () => {
    const handler = createSearchNodesHandler(fakeFigma(tree()));
    const result = (await handler({ name: 'submit' })) as SearchNodesResult;
    expect(result.nodes.map(n => n.id)).toEqual(['1:2', '1:3']);
  });

  it('matches by exact type', async () => {
    const handler = createSearchNodesHandler(fakeFigma(tree()));
    const result = (await handler({ type: 'TEXT' })) as SearchNodesResult;
    expect(result.nodes.map(n => n.id)).toEqual(['1:2', '1:4']);
  });

  it('ANDs name and type together', async () => {
    const handler = createSearchNodesHandler(fakeFigma(tree()));
    const result = (await handler({ name: 'submit', type: 'TEXT' })) as SearchNodesResult;
    expect(result.nodes.map(n => n.id)).toEqual(['1:2']);
  });

  it('scopes to a root subtree when root id given', async () => {
    const nodes = tree();
    const handler = createSearchNodesHandler(
      fakeFigma(nodes, { '1:1': nodes[0] as unknown as BaseNode }),
    );
    const result = (await handler({ type: 'TEXT', root: '1:1' })) as SearchNodesResult;
    expect(result.nodes.map(n => n.id)).toEqual(['1:2']);
  });

  it('bounds main-component lookups on a large page without dropping or reordering matches', async () => {
    let pending = 0;
    let peak = 0;
    const instances = Array.from({ length: 1025 }, (_, index) => {
      const node = fake(`2:${index}`, 'INSTANCE', `Instance ${index}`);
      return Object.assign(node, {
        getMainComponentAsync: async () => {
          pending += 1;
          peak = Math.max(peak, pending);
          await Promise.resolve();
          if (index % 2 === 0) await Promise.resolve();
          pending -= 1;
          return { id: `3:${index}`, name: `Component ${index}`, key: `key-${index}` };
        },
      });
    });
    const page = { type: 'PAGE', children: instances } as unknown as PageNode;
    const handler = createSearchNodesHandler(fakeFigma([], { '1:1': page }));

    const result = (await handler({ root: '1:1', type: 'INSTANCE' })) as SearchNodesResult;

    expect(peak).toBeLessThanOrEqual(512);
    expect(result.nodes.map(node => node.id)).toEqual(instances.map(node => node.id));
    expect(result.nodes.map(node => node.mainComponent)).toEqual(
      instances.map((_, index) => ({
        id: `3:${index}`,
        name: `Component ${index}`,
        key: `key-${index}`,
      })),
    );
    expect(result.nodes.every(node => node.children === undefined)).toBe(true);
  });

  it('lets host timers run before all large-search matches are serialized', async () => {
    let lookups = 0;
    const instances = Array.from({ length: 1025 }, (_, index) =>
      Object.assign(fake(`2:${index}`, 'INSTANCE', `Instance ${index}`), {
        getMainComponentAsync: async () => {
          lookups += 1;
          return null;
        },
      }),
    );
    const handler = createSearchNodesHandler(fakeFigma(instances));
    const hostTick = new Promise<number>(resolve => setTimeout(() => resolve(lookups), 0));

    const result = (await handler({ type: 'INSTANCE' })) as SearchNodesResult;

    expect(await hostTick).toBeLessThan(instances.length);
    expect(result.nodes).toHaveLength(instances.length);
  });

  it('throws when neither name nor type is provided', async () => {
    const handler = createSearchNodesHandler(fakeFigma(tree()));
    await expect(handler({})).rejects.toThrow(/at least one/);
  });

  it('throws when name or type is the wrong type', async () => {
    const handler = createSearchNodesHandler(fakeFigma(tree()));
    await expect(handler({ name: 123 })).rejects.toThrow(/name/);
    await expect(handler({ type: 123 })).rejects.toThrow(/type/);
  });
});
