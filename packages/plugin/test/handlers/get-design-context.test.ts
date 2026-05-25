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
  variables?: Record<string, { name: string; resolvedType: string }>;
  styles?: Record<string, { name: string; type: string }>;
}): typeof figma =>
  ({
    currentPage: { selection: opts.selection ?? [], children: opts.pageChildren ?? [] },
    getNodeByIdAsync: async (id: string) => opts.lookup?.[id] ?? null,
    getStyleByIdAsync: async (id: string) => opts.styles?.[id] ?? null,
    variables: {
      getVariableByIdAsync: async (id: string) => opts.variables?.[id] ?? null,
    },
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
    // P3: fontSize + fontName are deduped into a globalVars textStyle ref; characters/opacity stay inline
    expect(full.nodes[0]).toMatchObject({ characters: 'Hi', opacity: 0.5 });
    expect(full.nodes[0]?.fontSize).toBeUndefined();
    expect(full.nodes[0]?.fontName).toBeUndefined();
    const textRef = full.nodes[0]?.textStyle;
    expect(textRef).toMatch(/^text_/);
    expect(full.globalVars?.styles[textRef!]).toEqual({
      fontFamily: 'Inter',
      fontStyle: 'Bold',
      fontSize: 16,
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

  it('surfaces grounding fields (styleIds / boundVariables / componentProperties) at full detail only', async () => {
    const grounded = node({
      id: 'g',
      type: 'TEXT',
      characters: 'Hi',
      fillStyleId: 'S:fill1',
      textStyleId: 'S:text1',
      boundVariables: { fills: [{ id: 'VariableID:1' }], fontSize: { id: 'VariableID:2' } },
      componentProperties: { Size: { type: 'VARIANT', value: 'sm' }, Disabled: { type: 'BOOLEAN', value: false } },
    });

    const full = (await createGetDesignContextHandler(fakeFigma({ pageChildren: [grounded] }))({
      detail: 'full',
    })) as GetDesignContextResult;
    expect(full.nodes[0]).toMatchObject({
      styleIds: { fill: 'S:fill1', text: 'S:text1' },
      boundVariables: { fills: ['VariableID:1'], fontSize: ['VariableID:2'] },
      componentProperties: { Size: { type: 'VARIANT', value: 'sm' }, Disabled: { type: 'BOOLEAN', value: false } },
    });

    // compact must not leak the full-tier grounding fields
    const compact = (await createGetDesignContextHandler(fakeFigma({ pageChildren: [grounded] }))({
      detail: 'compact',
    })) as GetDesignContextResult;
    expect(compact.nodes[0]?.styleIds).toBeUndefined();
    expect(compact.nodes[0]?.boundVariables).toBeUndefined();
    expect(compact.nodes[0]?.componentProperties).toBeUndefined();
  });

  it('surfaces mainComponent name/key at full detail and preserves instance componentProperties through dedup', async () => {
    const main = { id: 'M:1', name: 'Button', key: 'abc123' };
    const mkInstance = (id: string, variant: string): SceneNode =>
      node({
        id,
        type: 'INSTANCE',
        componentProperties: { Variant: { type: 'VARIANT', value: variant } },
        children: [node({ id: `${id}-child`, type: 'TEXT' })],
        getMainComponentAsync: async () => main,
      });
    const result = (await createGetDesignContextHandler(
      fakeFigma({ pageChildren: [mkInstance('i1', 'primary'), mkInstance('i2', 'outline')] }),
    )({ dedupeComponents: true, detail: 'full' })) as GetDesignContextResult;

    // first instance: full main component + its own variant
    expect(result.nodes[0]?.mainComponent).toEqual({ id: 'M:1', name: 'Button', key: 'abc123' });
    expect(result.nodes[0]?.componentProperties).toEqual({ Variant: { type: 'VARIANT', value: 'primary' } });
    // second instance is deduped (children collapsed) yet KEEPS its distinct variant — the
    // constraint that lets component_map tell variants apart
    expect(result.nodes[1]?.deduped).toBe(true);
    expect(result.nodes[1]?.children).toBeUndefined();
    expect(result.nodes[1]?.componentProperties).toEqual({ Variant: { type: 'VARIANT', value: 'outline' } });
    expect(result.nodes[1]?.mainComponent).toEqual({ id: 'M:1', name: 'Button', key: 'abc123' });
  });

  it('resolves variable + style ids to a deduped top-level token map (full detail), stripping the styleId comma', async () => {
    const a = node({
      id: 'a',
      type: 'TEXT',
      fillStyleId: 'S:text1,', // Figma trailing-comma artifact
      boundVariables: { fills: [{ id: 'VariableID:181:4147' }] },
    });
    // second node references the SAME variable — must dedupe to one map entry
    const b = node({ id: 'b', type: 'TEXT', boundVariables: { fills: [{ id: 'VariableID:181:4147' }] } });

    const handler = createGetDesignContextHandler(
      fakeFigma({
        pageChildren: [a, b],
        variables: { 'VariableID:181:4147': { name: 'Primary/500', resolvedType: 'COLOR' } },
        styles: { 'S:text1': { name: 'Body/Bold', type: 'TEXT' } },
      }),
    );
    const full = (await handler({ detail: 'full' })) as GetDesignContextResult;

    // styleId comma stripped on the node so it joins the map key
    expect(full.nodes[0]?.styleIds).toEqual({ fill: 'S:text1' });
    expect(full.variables).toEqual({ 'VariableID:181:4147': { name: 'Primary/500', type: 'COLOR' } });
    expect(full.styles).toEqual({ 'S:text1': { name: 'Body/Bold', type: 'TEXT' } });
  });

  it('omits token maps below full detail and when refs are unresolvable', async () => {
    const ref = node({ id: 'r', type: 'TEXT', boundVariables: { fills: [{ id: 'VariableID:9:9' }] } });

    // compact: grounding fields not surfaced → no resolution
    const compact = (await createGetDesignContextHandler(
      fakeFigma({ pageChildren: [ref], variables: { 'VariableID:9:9': { name: 'X', resolvedType: 'COLOR' } } }),
    )({ detail: 'compact' })) as GetDesignContextResult;
    expect(compact.variables).toBeUndefined();

    // full but the lookup returns null (e.g. unsubscribed library var) → map omitted, no throw
    const full = (await createGetDesignContextHandler(
      fakeFigma({ pageChildren: [ref], variables: {} }),
    )({ detail: 'full' })) as GetDesignContextResult;
    expect(full.variables).toBeUndefined();
    expect(full.nodes[0]?.boundVariables).toEqual({ fills: ['VariableID:9:9'] }); // raw id stays as fallback
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
