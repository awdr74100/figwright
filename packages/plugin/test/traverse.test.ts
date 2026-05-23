import { describe, expect, it } from 'vitest';

import { resolveScope, walk } from '../src/traverse.js';

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
