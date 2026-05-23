import type { GetDesignContextResult } from '@figma-mcp-relay/shared';
import { describe, expect, it } from 'vitest';

import { createGetDesignContextHandler } from '../../src/handlers/get-design-context.js';

const node = (over: Record<string, unknown>): SceneNode =>
  ({
    id: 'x',
    name: 'x',
    type: 'FRAME',
    visible: true,
    locked: false,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    parent: { id: 'root' },
    ...over,
  }) as unknown as SceneNode;

const fakeFigma = (opts: {
  selection?: SceneNode[];
  pageChildren?: SceneNode[];
  lookup?: Record<string, BaseNode | null>;
}): typeof figma =>
  ({
    currentPage: { selection: opts.selection ?? [], children: opts.pageChildren ?? [] },
    getNodeByIdAsync: async (id: string) => opts.lookup?.[id] ?? null,
  }) as unknown as typeof figma;

describe('get_design_context handler', () => {
  it('limits depth and flags truncated nodes', async () => {
    const grandchild = node({ id: 'gc', type: 'RECTANGLE' });
    const child = node({ id: 'c', children: [grandchild] });
    const root = node({ id: 'r', children: [child] });
    const handler = createGetDesignContextHandler(fakeFigma({ pageChildren: [root] }));

    const result = (await handler({ depth: 1, detail: 'minimal' })) as GetDesignContextResult;
    const r = result.nodes[0];
    expect(r?.id).toBe('r');
    expect(r?.children?.[0]?.id).toBe('c');
    // depth=1 stops below the child: it has children, so it is marked truncated
    expect(r?.children?.[0]?.truncated).toBe(true);
    expect(r?.children?.[0]?.children).toBeUndefined();
  });

  it('projects fields by detail level', async () => {
    const text = node({
      id: 't',
      type: 'TEXT',
      characters: 'Hi',
      fontSize: 16,
      fontName: { family: 'Inter', style: 'Bold' },
      opacity: 0.5,
    });
    const min = (await createGetDesignContextHandler(fakeFigma({ pageChildren: [text] }))({
      detail: 'minimal',
    })) as GetDesignContextResult;
    expect(min.nodes[0]).toEqual({ id: 't', name: 'x', type: 'TEXT' });

    const compact = (await createGetDesignContextHandler(fakeFigma({ pageChildren: [text] }))({
      detail: 'compact',
    })) as GetDesignContextResult;
    expect(compact.nodes[0]).toMatchObject({ id: 't', visible: true, width: 10 });
    expect(compact.nodes[0]?.characters).toBeUndefined();

    const full = (await createGetDesignContextHandler(fakeFigma({ pageChildren: [text] }))({
      detail: 'full',
    })) as GetDesignContextResult;
    expect(full.nodes[0]).toMatchObject({
      characters: 'Hi',
      fontSize: 16,
      fontName: { family: 'Inter', style: 'Bold' },
      opacity: 0.5,
    });
  });

  it('defaults to selection, then falls back to the page', async () => {
    const sel = node({ id: 'sel' });
    const pageNode = node({ id: 'page' });
    const withSel = (await createGetDesignContextHandler(
      fakeFigma({ selection: [sel], pageChildren: [pageNode] }),
    )({})) as GetDesignContextResult;
    expect(withSel.nodes.map(n => n.id)).toEqual(['sel']);

    const noSel = (await createGetDesignContextHandler(
      fakeFigma({ selection: [], pageChildren: [pageNode] }),
    )({})) as GetDesignContextResult;
    expect(noSel.nodes.map(n => n.id)).toEqual(['page']);
  });

  it('dedupes repeated component instances', async () => {
    const main = { id: 'M:1' };
    const mkInstance = (id: string): SceneNode =>
      node({
        id,
        type: 'INSTANCE',
        children: [node({ id: `${id}-child`, type: 'TEXT' })],
        getMainComponentAsync: async () => main,
      });
    const handler = createGetDesignContextHandler(
      fakeFigma({ pageChildren: [mkInstance('i1'), mkInstance('i2')] }),
    );
    const result = (await handler({ dedupeComponents: true, detail: 'minimal' })) as GetDesignContextResult;

    expect(result.nodes[0]?.mainComponentId).toBe('M:1');
    expect(result.nodes[0]?.deduped).toBeUndefined();
    expect(result.nodes[0]?.children?.[0]?.id).toBe('i1-child');
    // second instance of the same main component is collapsed
    expect(result.nodes[1]?.deduped).toBe(true);
    expect(result.nodes[1]?.children).toBeUndefined();
  });

  it('resolves a nodeId root, returning empty for misses', async () => {
    const target = node({ id: '1:2' });
    const handler = createGetDesignContextHandler(
      fakeFigma({ lookup: { '1:2': target as unknown as BaseNode } }),
    );
    expect(((await handler({ nodeId: '1:2' })) as GetDesignContextResult).nodes[0]?.id).toBe('1:2');
    expect(((await handler({ nodeId: 'nope' })) as GetDesignContextResult).nodes).toEqual([]);
  });

  it('throws on invalid depth / detail / nodeId / dedupeComponents', async () => {
    const handler = createGetDesignContextHandler(fakeFigma({}));
    await expect(handler({ depth: -1 })).rejects.toThrow(/depth/);
    await expect(handler({ detail: 'huge' })).rejects.toThrow(/detail/);
    await expect(handler({ nodeId: 5 })).rejects.toThrow(/nodeId/);
    await expect(handler({ dedupeComponents: 'yes' })).rejects.toThrow(/dedupeComponents/);
  });
});
