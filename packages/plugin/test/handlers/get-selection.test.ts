import type { GetSelectionResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createGetSelectionHandler } from '../../src/handlers/get-selection.js';

const fakeNode = (overrides: Partial<SceneNode> = {}): SceneNode =>
  ({
    id: '1:2',
    name: 'Rect',
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

const fakeFigma = (selection: readonly SceneNode[]): typeof figma =>
  ({
    currentPage: {
      id: 'page-1',
      name: 'Cover',
      selection,
    },
  }) as unknown as typeof figma;

describe('get_selection handler', () => {
  it('returns empty nodes when nothing selected', async () => {
    const handler = createGetSelectionHandler(fakeFigma([]));
    const result = (await handler(undefined)) as GetSelectionResult;
    expect(result).toEqual({ pageId: 'page-1', pageName: 'Cover', nodes: [] });
  });

  it('serializes selected nodes with shared serializer', async () => {
    const handler = createGetSelectionHandler(
      fakeFigma([fakeNode(), fakeNode({ id: '1:3', name: 'Text', type: 'TEXT' })]),
    );
    const result = (await handler(undefined)) as GetSelectionResult;
    expect(result.pageId).toBe('page-1');
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0]).toMatchObject({ id: '1:2', type: 'RECTANGLE', parentId: '1:1' });
    expect(result.nodes[1]).toMatchObject({ id: '1:3', type: 'TEXT', parentId: '1:1' });
  });

  it('handles nodes without a parent (parentId=null)', async () => {
    const handler = createGetSelectionHandler(
      fakeFigma([fakeNode({ parent: null as unknown as SceneNode['parent'] })]),
    );
    const result = (await handler(undefined)) as GetSelectionResult;
    expect(result.nodes[0]!.parentId).toBeNull();
  });
});
