import { describe, expect, it } from 'vitest';

import { computeMetrics, dedupeStyles } from '../src/design-context-dedupe.js';
import type { DesignContextNode } from '../src/design-context.js';

const solid = (r: number, g: number, b: number, opacity = 1) => ({
  type: 'SOLID' as const,
  visible: true,
  opacity,
  color: { r, g, b },
});

const textNode = (id: string, family: string, style: string, size: number): DesignContextNode => ({
  id,
  name: id,
  type: 'TEXT',
  fontSize: size,
  fontName: { family, style },
});

describe('dedupeStyles', () => {
  it('converts SOLID fills to hex and replaces them with a globalVars ref', () => {
    const n: DesignContextNode = {
      id: 'a',
      name: 'a',
      type: 'RECTANGLE',
      fills: [solid(0.3843137, 0.4, 0.9411764)], // #6266F0
    };
    const { nodes, globalVars } = dedupeStyles([n]);

    expect(nodes[0]?.fills).toBeUndefined();
    const ref = nodes[0]?.fill;
    expect(ref).toMatch(/^fill_/);
    expect(globalVars.styles[ref!]).toEqual([{ type: 'SOLID', color: '#6266F0' }]);
  });

  it('folds opacity < 1 into an 8-digit hex alpha', () => {
    const { nodes, globalVars } = dedupeStyles([
      { id: 'a', name: 'a', type: 'RECTANGLE', fills: [solid(1, 1, 1, 0.5)] },
    ]);
    expect(globalVars.styles[nodes[0]!.fill!]).toEqual([{ type: 'SOLID', color: '#FFFFFF80' }]);
  });

  it('hoists effects (drop-shadow) and strokes into refs, converting colors to hex', () => {
    const n: DesignContextNode = {
      id: 'card',
      name: 'card',
      type: 'FRAME',
      strokes: [solid(0.9, 0.9, 0.9)],
      strokeWeight: 1,
      effects: [
        {
          type: 'DROP_SHADOW',
          visible: true,
          radius: 8,
          spread: 0,
          offset: { x: 0, y: 2 },
          color: { r: 0, g: 0, b: 0, a: 0.25 },
        },
      ],
    };
    const { nodes, globalVars } = dedupeStyles([n]);

    expect(nodes[0]?.strokes).toBeUndefined();
    expect(nodes[0]?.effects).toBeUndefined();
    expect(nodes[0]?.strokeWeight).toBe(1); // scalar stays inline
    expect(globalVars.styles[nodes[0]!.stroke!]).toEqual([{ type: 'SOLID', color: '#E6E6E6' }]);
    expect(globalVars.styles[nodes[0]!.effect!]).toEqual([
      { type: 'DROP_SHADOW', color: '#00000040', offset: { x: 0, y: 2 }, radius: 8, spread: 0 },
    ]);
  });

  it('deduplicates identical styles to one entry shared by many refs (the 100-buttons case)', () => {
    const items = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].map(id =>
      textNode(id, 'Noto Sans JP', 'Regular', 16),
    );
    const { nodes, globalVars } = dedupeStyles(items);

    // one shared text style, six identical refs
    expect(Object.keys(globalVars.styles)).toHaveLength(1);
    const refs = new Set(nodes.map(n => n.textStyle));
    expect(refs.size).toBe(1);
    expect(globalVars.styles[nodes[0]!.textStyle!]).toEqual({
      fontFamily: 'Noto Sans JP',
      fontStyle: 'Regular',
      fontSize: 16,
    });
  });

  it('produces deterministic, content-derived ids (stable across runs, diffable)', () => {
    const make = (): DesignContextNode[] => [textNode('x', 'Inter', 'Bold', 14)];
    const a = dedupeStyles(make());
    const b = dedupeStyles(make());
    expect(a.nodes[0]?.textStyle).toBe(b.nodes[0]?.textStyle);
  });

  it('recurses into children and leaves MIXED / ref-less nodes untouched', () => {
    const tree: DesignContextNode = {
      id: 'root',
      name: 'root',
      type: 'FRAME',
      children: [textNode('t', 'Inter', 'Bold', 14), { id: 'plain', name: 'plain', type: 'FRAME' }],
    };
    const { nodes, globalVars } = dedupeStyles([tree]);
    expect(nodes[0]?.children?.[0]?.textStyle).toMatch(/^text_/);
    expect(nodes[0]?.children?.[1]).toEqual({ id: 'plain', name: 'plain', type: 'FRAME' });
    expect(Object.keys(globalVars.styles)).toHaveLength(1);
  });
});

describe('computeMetrics', () => {
  it('reports node/style/token counts and a dedup size win', () => {
    const inline = ['m1', 'm2', 'm3'].map(id => textNode(id, 'Noto Sans JP', 'Regular', 16));
    const { nodes, globalVars } = dedupeStyles(inline);
    const result = {
      nodes,
      globalVars,
      variables: { 'VariableID:1': { name: 'Primary/500', type: 'COLOR' } },
      styles: {},
    };
    const m = computeMetrics(inline, result);

    expect(m.nodeCount).toBe(3);
    expect(m.maxDepth).toBe(1);
    expect(m.styleCount).toBe(1);
    expect(m.tokenCount).toBe(1);
    // deduped form (3 short refs + 1 style) is smaller than 3 inline copies
    expect(m.dedupedSizeKb).toBeLessThan(m.inlineSizeKb);
  });
});
