import { describe, expect, it, vi } from 'vitest';

import { resolveScope, walk, walkCooperatively } from '../src/traverse.js';

const node = (id: string, type: string, children?: SceneNode[]): SceneNode =>
  ({ id, type, name: id, children }) as unknown as SceneNode;

const collect = async (nodes: readonly SceneNode[]): Promise<SceneNode[]> => {
  const result: SceneNode[] = [];
  for await (const value of walkCooperatively(nodes)) result.push(value);
  return result;
};

describe('walkCooperatively', () => {
  it('preserves complete depth-first order across wide, nested forests', async () => {
    const roots = Array.from({ length: 1025 }, (_, index) =>
      node(`root-${index}`, 'FRAME', [node(`child-${index}`, 'TEXT')]),
    );
    expect(await collect(roots)).toEqual([...walk(roots)]);
  });

  it('reads each native children array once and sees edits on the next traversal', async () => {
    let reads = 0;
    let children = [node('a', 'TEXT')];
    const root = node('root', 'FRAME');
    Object.defineProperty(root, 'children', {
      get: () => {
        reads += 1;
        return children;
      },
    });
    expect((await collect([root])).map(value => value.id)).toEqual(['root', 'a']);
    children = [node('b', 'TEXT')];
    expect((await collect([root])).map(value => value.id)).toEqual(['root', 'b']);
    expect(reads).toBe(2);
  });

  it('handles deep trees without recursive generator stack growth', async () => {
    let root = node('leaf', 'TEXT');
    for (let depth = 0; depth < 5000; depth += 1) root = node(`level-${depth}`, 'FRAME', [root]);
    const result = await collect([root]);
    expect(result).toHaveLength(5001);
    expect(result[0]?.id).toBe('level-4999');
    expect(result.at(-1)?.id).toBe('leaf');
  });

  it('handles an empty forest', async () => {
    expect(await collect([])).toEqual([]);
  });

  it('yields during expensive native child reads below the node-count limit', async () => {
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
      const result = await collect(roots);
      expect(await hostTick).toBeLessThan(roots.length);
      expect(result).toEqual(roots);
      expect(reads).toBe(roots.length);
    } finally {
      clock.mockRestore();
    }
  });

  it('yields after bounded visits even when native reads are cheap', async () => {
    let visits = 0;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
    const roots = Array.from({ length: 1025 }, (_, index) => node(`root-${index}`, 'VECTOR'));
    const hostTick = new Promise<number>(resolve => setTimeout(() => resolve(visits), 0));
    try {
      for await (const value of walkCooperatively(roots)) {
        expect(value).toBe(roots[visits]);
        visits += 1;
      }
      expect(await hostTick).toBe(512);
      expect(visits).toBe(roots.length);
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
    await expect(collect([root])).rejects.toBe(failure);
  });
});

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
