import type { GetDocumentResult } from '@figma-mcp-relay/shared';
import { describe, expect, it } from 'vitest';

import { createGetDocumentHandler } from '../../src/handlers/get-document.js';

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

const fakeFigma = (children: readonly SceneNode[]): typeof figma =>
  ({
    currentPage: {
      id: 'page-1',
      name: 'Cover',
      children,
    },
  }) as unknown as typeof figma;

describe('get_document handler', () => {
  it('returns empty children when page is empty', async () => {
    const handler = createGetDocumentHandler(fakeFigma([]));
    const result = (await handler(undefined)) as GetDocumentResult;
    expect(result).toEqual({ pageId: 'page-1', pageName: 'Cover', children: [] });
  });

  it('serializes a flat page (no nested children)', async () => {
    const handler = createGetDocumentHandler(
      fakeFigma([fake({ id: '1:2' }), fake({ id: '1:3', type: 'TEXT' })]),
    );
    const result = (await handler(undefined)) as GetDocumentResult;
    expect(result.children).toHaveLength(2);
    expect(result.children[0]).toMatchObject({ id: '1:2', type: 'RECTANGLE' });
    expect(result.children[1]).toMatchObject({ id: '1:3', type: 'TEXT' });
  });

  it('recurses nested children into a tree', async () => {
    const leaf = fake({ id: '1:4', parent: { id: '1:3' } });
    const branch = fake({ id: '1:3', type: 'FRAME', parent: { id: '1:2' }, children: [leaf] });
    const root = fake({ id: '1:2', type: 'FRAME', parent: null, children: [branch] });
    const handler = createGetDocumentHandler(fakeFigma([root]));
    const result = (await handler(undefined)) as GetDocumentResult;
    expect(result.children[0]?.id).toBe('1:2');
    expect(result.children[0]?.children?.[0]?.id).toBe('1:3');
    expect(result.children[0]?.children?.[0]?.children?.[0]?.id).toBe('1:4');
  });
});
