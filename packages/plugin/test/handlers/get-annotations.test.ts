import type { GetAnnotationsResult } from '@figma-mcp-relay/shared';
import { describe, expect, it } from 'vitest';

import { createGetAnnotationsHandler } from '../../src/handlers/get-annotations.js';

const node = (id: string, annotations: unknown[], children?: SceneNode[]): SceneNode =>
  ({ id, name: id, type: 'FRAME', annotations, children }) as unknown as SceneNode;

const fakeFigma = (
  pageChildren: SceneNode[],
  lookup: Record<string, BaseNode | null> = {},
): typeof figma =>
  ({
    currentPage: { children: pageChildren },
    getNodeByIdAsync: async (id: string) => lookup[id] ?? null,
  }) as unknown as typeof figma;

describe('get_annotations handler', () => {
  it('scans the current page for annotated nodes when no nodeId given', async () => {
    const page = [
      node(
        '1',
        [{ label: 'Use token', properties: [{ type: 'fills' }, { type: 'cornerRadius' }] }],
        [node('2', [])],
      ),
      node('3', [{ labelMarkdown: '**bold**', categoryId: 'cat-1' }]),
    ];
    const result = (await createGetAnnotationsHandler(fakeFigma(page))(
      undefined,
    )) as GetAnnotationsResult;
    expect(result.annotations.map(a => a.nodeId)).toEqual(['1', '3']);
    expect(result.annotations[0]?.annotations[0]).toEqual({
      label: 'Use token',
      properties: ['fills', 'cornerRadius'],
    });
    expect(result.annotations[1]?.annotations[0]).toEqual({
      labelMarkdown: '**bold**',
      categoryId: 'cat-1',
    });
  });

  it('returns annotations for a single node when nodeId given', async () => {
    const target = node('9', [{ label: 'Spacing' }]);
    const handler = createGetAnnotationsHandler(
      fakeFigma([], { '9': target as unknown as BaseNode }),
    );
    const result = (await handler({ nodeId: '9' })) as GetAnnotationsResult;
    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0]?.annotations[0]?.label).toBe('Spacing');
  });

  it('throws when nodeId is the wrong type', async () => {
    await expect(createGetAnnotationsHandler(fakeFigma([]))({ nodeId: 5 })).rejects.toThrow(
      /nodeId/,
    );
  });

  it('returns empty when the page has no annotated nodes', async () => {
    const result = (await createGetAnnotationsHandler(fakeFigma([node('1', [])]))(
      undefined,
    )) as GetAnnotationsResult;
    expect(result.annotations).toEqual([]);
  });
});
