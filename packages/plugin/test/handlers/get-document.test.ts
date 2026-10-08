import type { GetDocumentResult } from '@figwright/shared';
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

  it('lets timers run before a large page finishes without dropping any nodes', async () => {
    let serialized = 0;
    const children = Array.from({ length: 2_048 }, (_, i) => fake({ id: `1:${i + 2}` }));
    for (const node of children) {
      Object.defineProperty(node, 'name', {
        get: () => {
          serialized += 1;
          return `Node ${node.id}`;
        },
      });
    }
    const timer = new Promise<number>(resolve => setTimeout(() => resolve(serialized), 0));
    const handler = createGetDocumentHandler(fakeFigma(children));
    const result = (await handler(undefined)) as GetDocumentResult;
    const atTimer = await timer;
    expect(atTimer).toBeGreaterThan(0);
    expect(atTimer).toBeLessThan(children.length);
    expect(result.children.map(n => n.id)).toEqual(children.map(n => n.id));
  });

  it('bounds main-component lookups and preserves every instance on a large page', async () => {
    let active = 0;
    let peak = 0;
    const children = Array.from({ length: 512 }, (_, i) =>
      fake({
        id: `1:${i + 2}`,
        type: 'INSTANCE',
        getMainComponentAsync: async () => {
          active += 1;
          peak = Math.max(peak, active);
          await Promise.resolve();
          active -= 1;
          return { id: '2:1', name: 'Button', key: 'button' };
        },
      }),
    );
    const result = (await createGetDocumentHandler(fakeFigma(children))(
      undefined,
    )) as GetDocumentResult;
    expect(peak).toBeLessThanOrEqual(64);
    expect(result.children).toHaveLength(children.length);
    expect(result.children.every(n => n.mainComponent?.key === 'button')).toBe(true);
  });
});
