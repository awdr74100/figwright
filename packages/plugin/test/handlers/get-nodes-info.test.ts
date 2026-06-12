import type { GetNodesInfoResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createGetNodesInfoHandler } from '../../src/handlers/get-nodes-info.js';

const fake = (overrides: Record<string, unknown> = {}): SceneNode =>
  ({
    id: '1:2',
    name: 'Node',
    type: 'RECTANGLE',
    visible: true,
    locked: false,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    parent: { id: '1:1' },
    ...overrides,
  }) as unknown as SceneNode;

const fakeFigma = (lookup: Record<string, BaseNode | null>): typeof figma =>
  ({
    getNodeByIdAsync: async (id: string) => lookup[id] ?? null,
  }) as unknown as typeof figma;

describe('get_nodes_info handler', () => {
  it('throws when nodeIds is not a string[]', async () => {
    const handler = createGetNodesInfoHandler(fakeFigma({}));
    await expect(handler({ nodeIds: 'not-array' })).rejects.toThrow(/string\[]/);
    await expect(handler({ nodeIds: [1, 2] })).rejects.toThrow(/string\[]/);
  });

  it('returns serialized nodes preserving input order with null for missing', async () => {
    const a = fake({ id: '1:2' });
    const c = fake({ id: '1:4' });
    const handler = createGetNodesInfoHandler(
      fakeFigma({ '1:2': a as unknown as BaseNode, '1:4': c as unknown as BaseNode }),
    );
    const result = (await handler({ nodeIds: ['1:2', '1:3', '1:4'] })) as GetNodesInfoResult;
    expect(result.nodes).toHaveLength(3);
    expect(result.nodes[0]?.id).toBe('1:2');
    expect(result.nodes[1]).toBeNull();
    expect(result.nodes[2]?.id).toBe('1:4');
  });

  it('returns null slots for DOCUMENT / PAGE types', async () => {
    const pageNode = { id: 'p-1', type: 'PAGE' } as unknown as BaseNode;
    const handler = createGetNodesInfoHandler(fakeFigma({ 'p-1': pageNode }));
    const result = (await handler({ nodeIds: ['p-1'] })) as GetNodesInfoResult;
    expect(result.nodes).toEqual([null]);
  });
});
