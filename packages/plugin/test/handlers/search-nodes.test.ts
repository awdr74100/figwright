import type { SearchNodesResult } from '@figma-mcp-relay/shared';
import { describe, expect, it } from 'vitest';

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
