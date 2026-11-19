import type { GetAnnotationsResult } from '@figwright/shared';
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

  it('lists every category in the file, cited or not', async () => {
    const categories = [
      {
        id: '127:0',
        label: 'Development',
        color: 'green',
        isPreset: true,
        remove: () => undefined,
      },
      { id: '134:1', label: 'Analytics', color: 'teal', isPreset: false, remove: () => undefined },
    ];
    const f = {
      ...fakeFigma([node('1', [{ label: 'x', categoryId: '127:0' }])]),
      annotations: { getAnnotationCategoriesAsync: async () => categories },
    } as unknown as typeof figma;
    const result = (await createGetAnnotationsHandler(f)(undefined)) as GetAnnotationsResult;
    expect(result.categories).toEqual([
      { id: '127:0', label: 'Development', color: 'green', isPreset: true },
      { id: '134:1', label: 'Analytics', color: 'teal', isPreset: false },
    ]);
  });

  // FigJam has no annotations API; a read there answers exactly as it did before categories.
  it('leaves categories out where the editor has no annotations API', async () => {
    const result = (await createGetAnnotationsHandler(fakeFigma([]))(
      undefined,
    )) as GetAnnotationsResult;
    expect(result).toEqual({ annotations: [] });
  });
});
