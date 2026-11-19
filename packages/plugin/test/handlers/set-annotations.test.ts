import type { AnnotationsResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createSetAnnotationsHandler } from '../../src/handlers/set-annotations.js';
import { annotatedNode } from '../annotations-fake.js';

const fakeFigma = (
  node: unknown,
  categories: { id: string; label: string }[] = [{ id: '127:0', label: 'Development' }],
) =>
  ({
    getNodeByIdAsync: async () => node,
    annotations: {
      getAnnotationCategoryByIdAsync: async (id: string) =>
        categories.find(c => c.id === id) ?? null,
      getAnnotationCategoriesAsync: async () => categories,
    },
  }) as unknown as typeof figma;

describe('set_annotations handler', () => {
  it('replaces the list and returns it as Figma holds it', async () => {
    const node = annotatedNode();
    const result = (await createSetAnnotationsHandler(fakeFigma(node))({
      nodeId: '1:1',
      annotations: [
        { label: 'Use the brand token', categoryId: '127:0', properties: ['fills'] },
        { labelMarkdown: '**hover** only' },
      ],
    })) as AnnotationsResult;
    expect(result).toEqual({
      ok: true,
      nodeId: '1:1',
      annotations: [
        {
          label: 'Use the brand token',
          labelMarkdown: 'Use the brand token',
          categoryId: '127:0',
          properties: ['fills'],
        },
        { label: 'hover only', labelMarkdown: '**hover** only' },
      ],
    });
    await createSetAnnotationsHandler(fakeFigma(node))({ nodeId: '1:1', annotations: [] });
    expect(node.annotations).toEqual([]);
  });

  // GROUP, SECTION, BOOLEAN_OPERATION, SLICE and PAGE take the write and store nothing (measured).
  it('refuses a node that keeps no annotations, rather than answer ok for nothing', async () => {
    const group = { id: '2:2', type: 'GROUP' };
    await expect(
      createSetAnnotationsHandler(fakeFigma(group))({
        nodeId: '2:2',
        annotations: [{ label: 'x' }],
      }),
    ).rejects.toThrow(
      /^set_annotations: node 2:2 is a GROUP, which keeps no annotations — Figma takes the write and stores nothing/,
    );
    expect(group).not.toHaveProperty('annotations');
  });

  it('refuses a category no category has, listing the ones there are, and writes nothing', async () => {
    const node = annotatedNode();
    await expect(
      createSetAnnotationsHandler(fakeFigma(node))({
        nodeId: '1:1',
        annotations: [{ label: 'x', categoryId: '999:999' }],
      }),
    ).rejects.toThrow(
      'set_annotations: no annotation category 999:999 — Figma would keep the id pointing at nothing. Categories in this file: 127:0 "Development" (create_annotation_category adds one).',
    );
    expect(node.annotations).toEqual([]);
  });

  it("says what Figma's property refusal checks", async () => {
    const node = annotatedNode(['width']);
    await expect(
      createSetAnnotationsHandler(fakeFigma(node))({
        nodeId: '1:1',
        annotations: [{ label: 'x', properties: ['strokes'] }],
      }),
    ).rejects.toThrow(
      /Invalid property "strokes" for a FRAME node \(set_annotations: Figma pins a property only where the node has it set/,
    );
  });

  it('reports what Figma stored differently', async () => {
    const node = annotatedNode();
    const result = (await createSetAnnotationsHandler(fakeFigma(node))({
      nodeId: '1:1',
      annotations: [{ label: '  note  ' }],
    })) as AnnotationsResult;
    expect(result.adjusted).toMatch(/^annotations\[0\]\.label was stored as "note"/);
  });

  it('checks its arguments before looking anything up', async () => {
    const run = (params: unknown) => createSetAnnotationsHandler(fakeFigma(null))(params);
    await expect(run({ annotations: [] })).rejects.toThrow(
      'set_annotations: nodeId must be a string',
    );
    await expect(run({ nodeId: '1:1', annotations: {} })).rejects.toThrow(
      'annotations must be an array',
    );
    await expect(run({ nodeId: '1:1', annotations: [{ label: '  ' }] })).rejects.toThrow(
      'only whitespace',
    );
    await expect(run({ nodeId: '9:9', annotations: [] })).rejects.toThrow(
      'set_annotations: node 9:9 not found',
    );
  });
});
