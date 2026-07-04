import type { GetDesignContextResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { deepEqual, diffDesignContext } from '../../src/diff/design-diff.js';

// A minimal but realistic get_design_context result: one root frame with two children, styles
// deduped into globalVars, one bound variable. Overrides let each test mutate a slice.
const ctx = (over: Partial<GetDesignContextResult> = {}): GetDesignContextResult => ({
  nodes: [
    {
      id: '1:1',
      name: 'Card',
      type: 'FRAME',
      layout: { mode: 'VERTICAL', paddingTop: 16, paddingBottom: 16, itemSpacing: 8 } as never,
      children: [
        { id: '1:2', name: 'Title', type: 'TEXT', characters: 'Hello', fill: 'fill_A' },
        {
          id: '1:3',
          name: 'Body',
          type: 'TEXT',
          characters: 'World',
          boundVariables: { fills: ['V:1'] },
        },
      ],
    },
  ],
  globalVars: {
    styles: {
      fill_A: [{ type: 'SOLID', color: '#111111' }],
      fill_B: [{ type: 'SOLID', color: '#EE0000' }],
    },
  },
  variables: { 'V:1': { name: 'Primary/500', type: 'COLOR' } },
  ...over,
});

describe('diffDesignContext', () => {
  it('reports no changes for identical snapshots', () => {
    const d = diffDesignContext(ctx(), ctx());
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.changed).toEqual([]);
  });

  it('resolves a globalVars fill ref so a fill change reads as the paint value, not the hash', () => {
    const after = ctx();
    // Title now points at fill_B (red) instead of fill_A.
    (after.nodes[0]!.children![0] as { fill?: string }).fill = 'fill_B';
    const d = diffDesignContext(ctx(), after);
    expect(d.changed).toHaveLength(1);
    const change = d.changed[0]!;
    expect(change.id).toBe('1:2');
    expect(change.path).toBe('Card / Title');
    const fill = change.fields!.find(f => f.field === 'fill')!;
    // Resolved: before = the #111111 bundle, after = the #EE0000 bundle (not "fill_A" → "fill_B").
    expect(fill.before).toEqual([{ type: 'SOLID', color: '#111111' }]);
    expect(fill.after).toEqual([{ type: 'SOLID', color: '#EE0000' }]);
  });

  it('reports a layout (padding) delta at field granularity', () => {
    const after = ctx();
    (after.nodes[0]!.layout as { paddingTop: number }).paddingTop = 24;
    const d = diffDesignContext(ctx(), after);
    expect(d.changed).toHaveLength(1);
    const layout = d.changed[0]!.fields!.find(f => f.field === 'layout')!;
    expect((layout.before as { paddingTop: number }).paddingTop).toBe(16);
    expect((layout.after as { paddingTop: number }).paddingTop).toBe(24);
  });

  it('reports a text content change', () => {
    const after = ctx();
    (after.nodes[0]!.children![0] as { characters: string }).characters = 'Hi there';
    const d = diffDesignContext(ctx(), after);
    const chars = d.changed[0]!.fields!.find(f => f.field === 'characters')!;
    expect(chars.before).toBe('Hello');
    expect(chars.after).toBe('Hi there');
  });

  it('resolves a bound-variable rebind to token names', () => {
    const after = ctx({
      variables: {
        'V:1': { name: 'Primary/500', type: 'COLOR' },
        'V:2': { name: 'Primary/600', type: 'COLOR' },
      },
    });
    (after.nodes[0]!.children![1] as { boundVariables?: unknown }).boundVariables = {
      fills: ['V:2'],
    };
    const d = diffDesignContext(ctx(), after);
    const bound = d.changed[0]!.fields!.find(f => f.field === 'boundVariables')!;
    expect(bound.before).toEqual({ fills: ['Primary/500'] });
    expect(bound.after).toEqual({ fills: ['Primary/600'] });
  });

  it('classifies an added node', () => {
    const after = ctx();
    after.nodes[0]!.children = [
      ...after.nodes[0]!.children!,
      { id: '1:4', name: 'Badge', type: 'INSTANCE' },
    ];
    const d = diffDesignContext(ctx(), after);
    expect(d.added).toHaveLength(1);
    expect(d.added[0]).toMatchObject({
      id: '1:4',
      name: 'Badge',
      kind: 'added',
      path: 'Card / Badge',
    });
    expect(d.added[0]!.fields).toBeUndefined();
  });

  it('classifies a removed node', () => {
    const after = ctx();
    after.nodes[0]!.children = [after.nodes[0]!.children![0]!]; // drop Body
    const d = diffDesignContext(ctx(), after);
    expect(d.removed).toHaveLength(1);
    expect(d.removed[0]).toMatchObject({ id: '1:3', name: 'Body', kind: 'removed' });
  });

  it('reports a reparent as a `parent` field change (not add+remove)', () => {
    const before = ctx();
    // Move Body (1:3) out to the root as a sibling of Card.
    const after = ctx();
    after.nodes[0]!.children = [after.nodes[0]!.children![0]!];
    after.nodes = [
      ...after.nodes,
      {
        id: '1:3',
        name: 'Body',
        type: 'TEXT',
        characters: 'World',
        boundVariables: { fills: ['V:1'] },
      },
    ];
    const d = diffDesignContext(before, after);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    const parent = d.changed.find(c => c.id === '1:3')!.fields!.find(f => f.field === 'parent')!;
    expect(parent.before).toBe('1:1');
    expect(parent.after).toBe(null);
  });

  it('reports a pure sibling reorder as an `order` change', () => {
    const after = ctx();
    after.nodes[0]!.children = [after.nodes[0]!.children![1]!, after.nodes[0]!.children![0]!]; // swap
    const d = diffDesignContext(ctx(), after);
    const title = d.changed.find(c => c.id === '1:2')!;
    const order = title.fields!.find(f => f.field === 'order')!;
    expect(order.before).toBe(0);
    expect(order.after).toBe(1);
    // A reorder must not also emit a `parent` change (same parent).
    expect(title.fields!.some(f => f.field === 'parent')).toBe(false);
  });
});

describe('deepEqual', () => {
  it('compares primitives, arrays, and nested objects structurally', () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual(null, undefined)).toBe(false);
  });
});
