import { describe, expect, it, vi } from 'vitest';

import { collectMatches, flattenForest, resolveScope, walk } from '../src/traverse.js';

const node = (id: string, type: string, children?: SceneNode[]): SceneNode =>
  ({ id, type, name: id, children }) as unknown as SceneNode;

describe('walk', () => {
  it('yields each node depth-first pre-order', () => {
    const tree = node('a', 'FRAME', [
      node('b', 'FRAME', [node('c', 'TEXT')]),
      node('d', 'RECTANGLE'),
    ]);
    expect([...walk([tree])].map(n => n.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('treats leaf nodes (no children mixin) as terminal', () => {
    expect([...walk([node('x', 'RECTANGLE')])].map(n => n.id)).toEqual(['x']);
  });

  it('handles an empty forest', () => {
    expect([...walk([])]).toEqual([]);
  });
});

// A frame whose `children` getter counts reads, the way Figma's native getter builds a new array.
const countedFrame = (
  id: string,
  children: SceneNode[],
): { frame: SceneNode; reads: () => number } => {
  let reads = 0;
  const frame = { id, type: 'FRAME', name: id } as unknown as SceneNode;
  Object.defineProperty(frame, 'children', {
    get: () => {
      reads += 1;
      return children.slice();
    },
  });
  return { frame, reads: () => reads };
};

describe('walk — native children reads', () => {
  it("reads each node's children once", () => {
    const { frame, reads } = countedFrame('a', [node('b', 'TEXT'), node('c', 'TEXT')]);
    expect([...walk([frame])].map(n => n.id)).toEqual(['a', 'b', 'c']);
    expect(reads()).toBe(1);
  });
});

const forest = (): SceneNode[] => [
  node('a', 'FRAME', [node('b', 'FRAME', [node('c', 'TEXT')]), node('d', 'FRAME', [])]),
  node('e', 'TEXT'),
];

describe('collectMatches', () => {
  it('matches what walk yields, in the same order', async () => {
    const matches = await collectMatches(forest(), n => n.type === 'TEXT');
    expect(matches.map(n => n.id)).toEqual(
      [...walk(forest())].filter(n => n.type === 'TEXT').map(n => n.id),
    );
  });

  it("reads each node's children once", async () => {
    const { frame, reads } = countedFrame('a', [node('b', 'TEXT')]);
    await collectMatches([frame], () => true);
    expect(reads()).toBe(1);
  });

  it('hands the thread back to Figma during a long walk', async () => {
    const wide = [
      node(
        'root',
        'FRAME',
        Array.from({ length: 500 }, (_, i) => node(`${i}`, 'TEXT')),
      ),
    ];
    // Each Date.now() read advances 1ms, so slices end after a fixed number of nodes.
    let now = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => (now += 1));
    try {
      let finished = false;
      const walking = collectMatches(wide, () => true).then(found => {
        finished = true;
        return found;
      });
      expect(await new Promise<boolean>(resolve => setTimeout(() => resolve(finished), 0))).toBe(
        false,
      );
      expect(await walking).toHaveLength(501);
    } finally {
      clock.mockRestore();
    }
  });
});

describe('flattenForest', () => {
  it('lists nodes in pre-order with each parent position and whether it has children', async () => {
    const flat = await flattenForest(forest());
    expect(flat.nodes.map(n => n.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(flat.parents).toEqual([-1, 0, 1, 0, -1]);
    // d has an empty children array — still a container; c and e are leaves.
    expect(flat.hasChildren).toEqual([true, true, false, true, false]);
  });
});

describe('collectMatches / flattenForest — robustness', () => {
  it('handles deep trees without recursive stack growth', async () => {
    let root = node('leaf', 'TEXT');
    for (let depth = 0; depth < 5000; depth += 1) root = node(`level-${depth}`, 'FRAME', [root]);
    const matches = await collectMatches([root], () => true);
    expect(matches).toHaveLength(5001);
    expect(matches[0]?.id).toBe('level-4999');
    expect(matches.at(-1)?.id).toBe('leaf');
    expect((await flattenForest([root])).nodes).toHaveLength(5001);
  });

  it('yields during expensive native child reads, however few the nodes', async () => {
    let elapsed = 0;
    let reads = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => elapsed);
    const roots = Array.from({ length: 32 }, (_, index) =>
      Object.defineProperty(node(`root-${index}`, 'FRAME'), 'children', {
        get: () => {
          reads += 1;
          elapsed += 20;
          return [];
        },
      }),
    );
    const hostTick = new Promise<number>(resolve => setTimeout(() => resolve(reads), 0));
    try {
      expect(await collectMatches(roots, () => true)).toEqual(roots);
      expect(await hostTick).toBeLessThan(roots.length);
      expect(reads).toBe(roots.length);
    } finally {
      clock.mockRestore();
    }
  });

  it('propagates native children errors rather than returning a partial forest', async () => {
    const failure = new Error('native children unavailable');
    const root = Object.defineProperty(node('root', 'FRAME'), 'children', {
      get: () => {
        throw failure;
      },
    });
    await expect(collectMatches([root], () => true)).rejects.toBe(failure);
    await expect(flattenForest([root])).rejects.toBe(failure);
  });
});

const fakeFigma = (opts: {
  pageChildren?: SceneNode[];
  lookup?: Record<string, BaseNode | null>;
}): typeof figma =>
  ({
    currentPage: { children: opts.pageChildren ?? [] },
    getNodeByIdAsync: async (id: string) => opts.lookup?.[id] ?? null,
  }) as unknown as typeof figma;

describe('resolveScope', () => {
  it('defaults to the current page children when root omitted', async () => {
    const children = [node('a', 'FRAME')];
    const scope = await resolveScope(fakeFigma({ pageChildren: children }), undefined);
    expect(scope).toBe(children);
  });

  it('returns [node] for a SceneNode root id', async () => {
    const target = node('1:2', 'FRAME');
    const scope = await resolveScope(
      fakeFigma({ lookup: { '1:2': target as unknown as BaseNode } }),
      '1:2',
    );
    expect(scope.map(n => n.id)).toEqual(['1:2']);
  });

  it('returns the page children for a PAGE root id', async () => {
    const kids = [node('a', 'FRAME')];
    const page = { id: 'p-1', type: 'PAGE', children: kids } as unknown as BaseNode;
    const scope = await resolveScope(fakeFigma({ lookup: { 'p-1': page } }), 'p-1');
    expect(scope).toBe(kids);
  });

  it('returns empty for a missing node or DOCUMENT root', async () => {
    const doc = { id: 'doc', type: 'DOCUMENT' } as unknown as BaseNode;
    const figmaCtx = fakeFigma({ lookup: { doc, missing: null } });
    expect(await resolveScope(figmaCtx, 'missing')).toEqual([]);
    expect(await resolveScope(figmaCtx, 'doc')).toEqual([]);
  });

  it('throws when root is the wrong type', async () => {
    await expect(resolveScope(fakeFigma({}), 42)).rejects.toThrow(/root/);
  });
});
