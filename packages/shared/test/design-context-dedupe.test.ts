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
  it('carries a gradient’s cssAngle into globalVars, and keeps differently-angled gradients apart', () => {
    // The angle is what codegen actually emits, so dropping it here would leave the deduped view
    // with only the raw matrix again. And two nodes sharing a matrix but not a shape genuinely
    // render at different angles — collapsing them into one entry is the bug this field fixes.
    const paint = (cssAngle: number) => ({
      type: 'GRADIENT_LINEAR',
      visible: true,
      opacity: 1,
      cssAngle,
      gradientStops: [
        { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
        { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
      ],
      gradientTransform: [
        [0.5, 0.5, 0],
        [0, 1, 0],
      ],
    });
    const { globalVars } = dedupeStyles([
      { id: '1:1', name: 'Wide', type: 'FRAME', fills: [paint(165.96)] },
      { id: '1:2', name: 'Square', type: 'FRAME', fills: [paint(135)] },
      { id: '1:3', name: 'Wide again', type: 'FRAME', fills: [paint(165.96)] },
    ] as never);

    const entries = Object.values(globalVars.styles) as { cssAngle?: number }[][];
    const angles = entries.map(e => e[0]?.cssAngle).toSorted();
    // Three nodes, two distinct angles → two entries, and the repeat still dedupes.
    expect(entries).toHaveLength(2);
    expect(angles).toEqual([135, 165.96]);
  });

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

  it('carries a gradient fill with its stops AND the axis transform (direction not lost)', () => {
    const n: DesignContextNode = {
      id: 'a',
      name: 'a',
      type: 'RECTANGLE',
      fills: [
        {
          type: 'GRADIENT_LINEAR',
          visible: true,
          opacity: 1,
          gradientStops: [
            { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
            { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
          ],
          gradientTransform: [
            [0, 1, 0],
            [-1, 0, 1],
          ],
        },
      ],
    };
    const { nodes, globalVars } = dedupeStyles([n]);
    expect(globalVars.styles[nodes[0]!.fill!]).toEqual([
      {
        type: 'GRADIENT_LINEAR',
        gradientStops: [
          { position: 0, color: '#FF0000' },
          { position: 1, color: '#0000FF' },
        ],
        gradientTransform: [
          [0, 1, 0],
          [-1, 0, 1],
        ],
      },
    ]);
  });

  it('carries scaleMode (object-fit) on an IMAGE fill', () => {
    const { nodes, globalVars } = dedupeStyles([
      {
        id: 'a',
        name: 'a',
        type: 'RECTANGLE',
        fills: [{ type: 'IMAGE', visible: true, opacity: 1, scaleMode: 'FILL' }],
      },
    ]);
    expect(globalVars.styles[nodes[0]!.fill!]).toEqual([{ type: 'IMAGE', scaleMode: 'FILL' }]);
  });

  it('carries filtersApplied on an IMAGE fill (the export-the-composited-render signal)', () => {
    // The signal the LLM actually reads lives in globalVars (the simplified paint), not the raw
    // fill — so an in-fill colour grade must survive simplifyPaint, or codegen ships the original
    // ungraded bytes. Untouched images (no filtersApplied) stay lean.
    const { nodes, globalVars } = dedupeStyles([
      {
        id: 'a',
        name: 'a',
        type: 'RECTANGLE',
        fills: [
          { type: 'IMAGE', visible: true, opacity: 1, scaleMode: 'FILL', filtersApplied: true },
        ],
      },
      {
        id: 'b',
        name: 'b',
        type: 'RECTANGLE',
        fills: [{ type: 'IMAGE', visible: true, opacity: 1, scaleMode: 'FILL' }],
      },
    ]);
    expect(globalVars.styles[nodes[0]!.fill!]).toEqual([
      { type: 'IMAGE', scaleMode: 'FILL', filtersApplied: true },
    ]);
    expect(globalVars.styles[nodes[1]!.fill!]).toEqual([{ type: 'IMAGE', scaleMode: 'FILL' }]);
  });

  it('carries the tiling geometry on a PATTERN fill (source node + repeat)', () => {
    const { nodes, globalVars } = dedupeStyles([
      {
        id: 'a',
        name: 'a',
        type: 'RECTANGLE',
        fills: [
          {
            type: 'PATTERN',
            visible: true,
            opacity: 1,
            sourceNodeId: '12:34',
            tileType: 'RECTANGULAR',
            scalingFactor: 0.5,
            spacing: { x: 4, y: 8 },
            horizontalAlignment: 'CENTER',
          },
        ],
      },
    ]);
    expect(globalVars.styles[nodes[0]!.fill!]).toEqual([
      {
        type: 'PATTERN',
        sourceNodeId: '12:34',
        tileType: 'RECTANGULAR',
        scalingFactor: 0.5,
        spacing: { x: 4, y: 8 },
        horizontalAlignment: 'CENTER',
      },
    ]);
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

  it('keeps two weights of one variable font apart instead of folding them onto a single ref', () => {
    // Both are "Inter Regular"; only the axis values differ. Leaving variationSettings out of the
    // bundle made these hash the same, so a heading and its body copy shared one `text_N` entry and
    // codegen emitted whichever weight happened to be registered first for both.
    const heading: DesignContextNode = {
      ...textNode('heading', 'Inter', 'Regular', 16),
      fontName: { family: 'Inter', style: 'Regular', variationSettings: { wght: 700 } },
    };
    const body: DesignContextNode = {
      ...textNode('body', 'Inter', 'Regular', 16),
      fontName: { family: 'Inter', style: 'Regular', variationSettings: { wght: 400 } },
    };
    const { nodes, globalVars } = dedupeStyles([heading, body]);

    expect(nodes[0]?.textStyle).not.toBe(nodes[1]?.textStyle);
    expect(Object.keys(globalVars.styles)).toHaveLength(2);
    expect(globalVars.styles[nodes[0]!.textStyle!]).toEqual({
      fontFamily: 'Inter',
      fontStyle: 'Regular',
      fontVariationSettings: { wght: 700 },
      fontSize: 16,
    });
  });

  it('still shares one entry when the axis values match', () => {
    const make = (id: string): DesignContextNode => ({
      ...textNode(id, 'Inter', 'Regular', 16),
      fontName: { family: 'Inter', style: 'Regular', variationSettings: { wght: 550 } },
    });
    const { nodes, globalVars } = dedupeStyles([make('a'), make('b')]);
    expect(Object.keys(globalVars.styles)).toHaveLength(1);
    expect(nodes[0]?.textStyle).toBe(nodes[1]?.textStyle);
  });

  it("leaves a static font's bundle exactly as it was (no empty axis key)", () => {
    const { nodes, globalVars } = dedupeStyles([textNode('s', 'Inter', 'Regular', 16)]);
    expect(globalVars.styles[nodes[0]!.textStyle!]).toEqual({
      fontFamily: 'Inter',
      fontStyle: 'Regular',
      fontSize: 16,
    });
  });

  it('folds paragraphSpacing / paragraphIndent / textWrapStyle into the textStyle bundle (style-level, like lineHeight)', () => {
    const body: DesignContextNode = {
      ...textNode('body', 'Inter', 'Regular', 16),
      paragraphSpacing: 12,
      paragraphIndent: 24,
      textWrapStyle: 'PRETTY',
    };
    const { nodes, globalVars } = dedupeStyles([body]);

    // folded into the bundle, inline copies dropped
    expect(nodes[0]?.paragraphSpacing).toBeUndefined();
    expect(nodes[0]?.paragraphIndent).toBeUndefined();
    expect(nodes[0]?.textWrapStyle).toBeUndefined();
    expect(globalVars.styles[nodes[0]!.textStyle!]).toEqual({
      fontFamily: 'Inter',
      fontStyle: 'Regular',
      fontSize: 16,
      paragraphSpacing: 12,
      paragraphIndent: 24,
      textWrapStyle: 'PRETTY',
    });
  });

  it("emits a node's own style refs before its children (no shadow-on-child misattribution)", () => {
    const card: DesignContextNode = {
      id: 'card',
      name: 'card',
      type: 'FRAME',
      fills: [solid(1, 1, 1)],
      effects: [
        { type: 'DROP_SHADOW', visible: true, radius: 4, color: { r: 0, g: 0, b: 0, a: 0.25 } },
      ],
      children: [{ id: 'btn', name: 'btn', type: 'INSTANCE', fills: [solid(0.38, 0.4, 0.94)] }],
    };
    const { nodes } = dedupeStyles([card]);
    const keys = Object.keys(nodes[0]!);
    // the card's own fill + effect must come before the children array
    expect(keys.indexOf('children')).toBeGreaterThan(keys.indexOf('fill'));
    expect(keys.indexOf('children')).toBeGreaterThan(keys.indexOf('effect'));
    expect(keys[keys.length - 1]).toBe('children');
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

// A deliberate boundary, pinned so it cannot flip by accident.
//
// Paints and effects carry per-object `boundVariables` since issue #164, but the globalVars bundles
// are the hot, budget-constrained path (get_design_context, PR #162) — and the information is not
// lost there: a node's own `boundVariables` already lists every variable its fills / strokes /
// effects reference (measured against a live file: it is populated both for a binding made on the
// node and for one inherited from a shared style), and `resolveTokens` turns those ids into names.
// What the bundle drops is only *which field of which paint* — precision the caller does not need
// to emit `var(--token)`, and which would otherwise be duplicated on every deduped bundle.
describe('dedupeStyles — variable bindings stay out of the bundles', () => {
  const bound = (over: Record<string, unknown>): DesignContextNode =>
    ({ id: 'n', name: 'n', type: 'FRAME', ...over }) as DesignContextNode;

  it('drops per-paint and per-effect bindings from the globalVars bundle', () => {
    const { globalVars } = dedupeStyles([
      bound({
        fills: [{ ...solid(1, 0, 0), boundVariables: { color: 'VariableID:1' } }],
        effects: [
          {
            type: 'DROP_SHADOW',
            visible: true,
            radius: 4,
            color: { r: 0, g: 0, b: 0, a: 0.2 },
            offset: { x: 0, y: 2 },
            spread: 0,
            boundVariables: { color: 'VariableID:1' },
          },
        ],
        boundVariables: { fills: ['VariableID:1'], effects: ['VariableID:1'] },
      }),
    ]);
    expect(JSON.stringify(globalVars.styles)).not.toContain('boundVariables');
    expect(JSON.stringify(globalVars.styles)).not.toContain('VariableID');
  });

  it('keeps the node-level binding list, which is what names the token', () => {
    const { nodes } = dedupeStyles([
      bound({
        fills: [{ ...solid(1, 0, 0), boundVariables: { color: 'VariableID:1' } }],
        boundVariables: { fills: ['VariableID:1'] },
      }),
    ]);
    expect(nodes[0]?.boundVariables).toEqual({ fills: ['VariableID:1'] });
  });

  it('does not let a binding split one shared bundle into two', () => {
    // Two nodes with the same colour, one bound and one not, must still share a single bundle —
    // otherwise adding bindings would quietly inflate globalVars on a file that uses variables.
    const { globalVars } = dedupeStyles([
      bound({ id: 'a', fills: [{ ...solid(1, 0, 0), boundVariables: { color: 'VariableID:1' } }] }),
      bound({ id: 'b', fills: [solid(1, 0, 0)] }),
    ]);
    expect(Object.keys(globalVars.styles)).toHaveLength(1);
  });
});
