import { MIXED } from '@figma-mcp-relay/shared';
import { describe, expect, it } from 'vitest';

import {
  serializeEffect,
  serializeFlat,
  serializeFlatSync,
  serializeLayoutGrid,
  serializeTree,
} from '../src/serializer.js';

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

describe('serializeFlat', () => {
  it('returns only base fields when no mixin properties are present', () => {
    const out = serializeFlatSync(fake());
    expect(out).toEqual({
      id: '1:2',
      name: 'Node',
      type: 'RECTANGLE',
      visible: true,
      locked: false,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      parentId: '1:1',
    });
    expect(out.children).toBeUndefined();
  });

  it('enriches with rotation / opacity / cornerRadius / fills', () => {
    const out = serializeFlatSync(
      fake({
        rotation: 45,
        opacity: 0.5,
        cornerRadius: 8,
        fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0 } }],
      }),
    );
    expect(out.rotation).toBe(45);
    expect(out.opacity).toBe(0.5);
    expect(out.cornerRadius).toBe(8);
    expect(out.fills).toEqual([
      { type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0 } },
    ]);
  });

  it('marks cornerRadius=mixed when value is not a number (figma.mixed symbol)', () => {
    const out = serializeFlatSync(fake({ cornerRadius: Symbol('figma.mixed') }));
    expect(out.cornerRadius).toBe(MIXED);
  });

  it('marks fills=mixed when value is not an array', () => {
    const out = serializeFlatSync(fake({ fills: Symbol('figma.mixed') }));
    expect(out.fills).toBe(MIXED);
  });

  it('serializes a gradient paint with its stops and transform', () => {
    const out = serializeFlatSync(
      fake({
        fills: [
          {
            type: 'GRADIENT_LINEAR',
            visible: true,
            opacity: 0.8,
            gradientStops: [
              { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
              { position: 1, color: { r: 0, g: 0, b: 1, a: 0.5 } },
            ],
            gradientTransform: [
              [1, 0, 0],
              [0, 1, 0],
            ],
          },
        ],
      }),
    );
    expect(out.fills).toEqual([
      {
        type: 'GRADIENT_LINEAR',
        visible: true,
        opacity: 0.8,
        gradientStops: [
          { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
          { position: 1, color: { r: 0, g: 0, b: 1, a: 0.5 } },
        ],
        gradientTransform: [
          [1, 0, 0],
          [0, 1, 0],
        ],
      },
    ]);
  });

  it('carries scaleMode on an IMAGE fill (object-fit equivalent)', () => {
    const out = serializeFlatSync(
      fake({ fills: [{ type: 'IMAGE', visible: true, opacity: 1, scaleMode: 'FILL' }] }),
    );
    expect(out.fills).toEqual([{ type: 'IMAGE', visible: true, opacity: 1, scaleMode: 'FILL' }]);
  });

  it('serializes a PATTERN paint as type-only (no scaleMode)', () => {
    const out = serializeFlatSync(
      fake({ fills: [{ type: 'PATTERN', visible: false, opacity: 0.8 }] }),
    );
    expect(out.fills).toEqual([{ type: 'PATTERN', visible: false, opacity: 0.8 }]);
  });

  it('falls back paint.visible/opacity to defaults when undefined', () => {
    const out = serializeFlatSync(
      fake({ fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }] }),
    );
    expect(out.fills).toEqual([
      { type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 0 } },
    ]);
  });

  it('adds text mixin (characters / fontSize / fontName) for TEXT nodes', () => {
    const out = serializeFlatSync(
      fake({
        type: 'TEXT',
        characters: 'Hello',
        fontSize: 16,
        fontName: { family: 'Inter', style: 'Bold' },
      }),
    );
    expect(out.characters).toBe('Hello');
    expect(out.fontSize).toBe(16);
    expect(out.fontName).toEqual({ family: 'Inter', style: 'Bold' });
  });

  it('marks fontSize/fontName mixed when figma.mixed', () => {
    const out = serializeFlatSync(
      fake({
        type: 'TEXT',
        characters: 'Mixed',
        fontSize: Symbol('figma.mixed'),
        fontName: Symbol('figma.mixed'),
      }),
    );
    expect(out.fontSize).toBe(MIXED);
    expect(out.fontName).toBe(MIXED);
  });

  it('omits text mixin for non-TEXT nodes', () => {
    const out = serializeFlatSync(fake({ type: 'RECTANGLE' }));
    expect(out.characters).toBeUndefined();
    expect(out.fontSize).toBeUndefined();
    expect(out.fontName).toBeUndefined();
  });
});

describe('serializeFlat — strokes / effects / auto layout', () => {
  it('serializes strokes with weight and align', () => {
    const out = serializeFlatSync(
      fake({
        strokes: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 0 } }],
        strokeWeight: 2,
        strokeAlign: 'INSIDE',
      }),
    );
    expect(out.strokes).toEqual([
      { type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 0 } },
    ]);
    expect(out.strokeWeight).toBe(2);
    expect(out.strokeAlign).toBe('INSIDE');
  });

  it('marks strokeWeight=mixed when not a number', () => {
    const out = serializeFlatSync(
      fake({
        strokes: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 0 } }],
        strokeWeight: Symbol('figma.mixed'),
      }),
    );
    expect(out.strokeWeight).toBe(MIXED);
  });

  it('surfaces per-side strokeWeights when strokeWeight is mixed (e.g. a top/bottom-only border)', () => {
    const out = serializeFlatSync(
      fake({
        strokes: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 0 } }],
        strokeWeight: Symbol('figma.mixed'),
        strokeTopWeight: 1,
        strokeRightWeight: 0,
        strokeBottomWeight: 1,
        strokeLeftWeight: 0,
      }),
    );
    expect(out.strokeWeight).toBe(MIXED);
    expect(out.strokeWeights).toEqual({ top: 1, right: 0, bottom: 1, left: 0 });
  });

  it('omits strokeWeights when per-side weights are unavailable (not all numeric)', () => {
    const out = serializeFlatSync(
      fake({
        strokes: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 0 } }],
        strokeWeight: Symbol('figma.mixed'),
      }),
    );
    expect(out.strokeWeights).toBeUndefined();
  });

  it('omits stroke fields when strokes is empty', () => {
    const out = serializeFlatSync(fake({ strokes: [], strokeWeight: 1 }));
    expect(out.strokes).toBeUndefined();
    expect(out.strokeWeight).toBeUndefined();
  });

  it('serializes effects', () => {
    const out = serializeFlatSync(
      fake({
        effects: [
          {
            type: 'DROP_SHADOW',
            visible: true,
            radius: 4,
            color: { r: 0, g: 0, b: 0, a: 0.2 },
            offset: { x: 0, y: 2 },
            spread: 0,
            blendMode: 'NORMAL',
          },
        ],
      }),
    );
    expect(out.effects).toEqual([
      {
        type: 'DROP_SHADOW',
        visible: true,
        radius: 4,
        color: { r: 0, g: 0, b: 0, a: 0.2 },
        offset: { x: 0, y: 2 },
        spread: 0,
      },
    ]);
  });

  it('omits effects when empty', () => {
    expect(serializeFlatSync(fake({ effects: [] })).effects).toBeUndefined();
  });

  it('serializes auto layout for HORIZONTAL/VERTICAL layoutMode', () => {
    const out = serializeFlatSync(
      fake({
        type: 'FRAME',
        layoutMode: 'HORIZONTAL',
        paddingTop: 4,
        paddingRight: 8,
        paddingBottom: 4,
        paddingLeft: 8,
        itemSpacing: 12,
        primaryAxisAlignItems: 'CENTER',
        counterAxisAlignItems: 'MIN',
        layoutWrap: 'NO_WRAP',
      }),
    );
    expect(out.layout).toEqual({
      mode: 'HORIZONTAL',
      paddingTop: 4,
      paddingRight: 8,
      paddingBottom: 4,
      paddingLeft: 8,
      itemSpacing: 12,
      primaryAxisAlignItems: 'CENTER',
      counterAxisAlignItems: 'MIN',
      layoutWrap: 'NO_WRAP',
    });
  });

  it('serializes GRID layoutMode with counts / gaps / track sizes, no H/V-only fields', () => {
    const out = serializeFlatSync(
      fake({
        type: 'FRAME',
        layoutMode: 'GRID',
        paddingTop: 16,
        paddingRight: 16,
        paddingBottom: 16,
        paddingLeft: 16,
        gridRowCount: 2,
        gridColumnCount: 3,
        gridRowGap: 8,
        gridColumnGap: 12,
        gridRowSizes: [
          { type: 'FLEX', value: 1 },
          { type: 'FIXED', value: 100 },
        ],
        gridColumnSizes: [{ type: 'FLEX', value: 1 }],
      }),
    );
    expect(out.layout).toEqual({
      mode: 'GRID',
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16,
      gridRowCount: 2,
      gridColumnCount: 3,
      gridRowGap: 8,
      gridColumnGap: 12,
      gridRowSizes: [
        { type: 'FLEX', value: 1 },
        { type: 'FIXED', value: 100 },
      ],
      gridColumnSizes: [{ type: 'FLEX', value: 1 }],
    });
    // GRID must not leak H/V-only flex fields
    expect(out.layout?.itemSpacing).toBeUndefined();
    expect(out.layout?.primaryAxisAlignItems).toBeUndefined();
  });

  it('omits layout when layoutMode is NONE or absent', () => {
    expect(serializeFlatSync(fake({ type: 'FRAME', layoutMode: 'NONE' })).layout).toBeUndefined();
    expect(serializeFlatSync(fake({ type: 'RECTANGLE' })).layout).toBeUndefined();
  });
});

describe('serializeFlat — layout sizing / constraints / clipsContent', () => {
  it('captures auto-layout child sizing only when the parent is auto-layout', () => {
    const out = serializeFlatSync(
      fake({
        parent: { id: '1:1', layoutMode: 'HORIZONTAL' },
        layoutSizingHorizontal: 'FILL',
        layoutSizingVertical: 'HUG',
        layoutGrow: 1,
        layoutAlign: 'STRETCH',
        layoutPositioning: 'AUTO',
      }),
    );
    expect(out.layoutSizingHorizontal).toBe('FILL');
    expect(out.layoutSizingVertical).toBe('HUG');
    expect(out.layoutGrow).toBe(1);
    expect(out.layoutAlign).toBe('STRETCH');
    expect(out.layoutPositioning).toBeUndefined(); // AUTO is the default, omitted
    expect(out.constraints).toBeUndefined();
  });

  it('flags ABSOLUTE layoutPositioning', () => {
    const out = serializeFlatSync(
      fake({ parent: { id: '1:1', layoutMode: 'VERTICAL' }, layoutPositioning: 'ABSOLUTE' }),
    );
    expect(out.layoutPositioning).toBe('ABSOLUTE');
  });

  it('captures gridChild placement when the parent is a GRID (default span/align omitted)', () => {
    const out = serializeFlatSync(
      fake({
        parent: { id: '1:1', layoutMode: 'GRID' },
        gridRowAnchorIndex: 1,
        gridColumnAnchorIndex: 2,
        gridRowSpan: 2,
        gridColumnSpan: 1,
        gridChildHorizontalAlign: 'CENTER',
        gridChildVerticalAlign: 'AUTO',
      }),
    );
    expect(out.gridChild).toEqual({
      rowAnchorIndex: 1,
      columnAnchorIndex: 2,
      rowSpan: 2, // columnSpan 1 (default) and verticalAlign AUTO (default) are omitted
      horizontalAlign: 'CENTER',
    });
  });

  it('omits gridChild for an auto-flowed cell (anchor -1, default span / align)', () => {
    const out = serializeFlatSync(
      fake({
        parent: { id: '1:1', layoutMode: 'GRID' },
        gridRowAnchorIndex: -1,
        gridColumnAnchorIndex: -1,
        gridRowSpan: 1,
        gridColumnSpan: 1,
        gridChildHorizontalAlign: 'AUTO',
        gridChildVerticalAlign: 'AUTO',
      }),
    );
    expect(out.gridChild).toBeUndefined();
  });

  it('omits gridChild when the parent is not a GRID', () => {
    const out = serializeFlatSync(
      fake({
        parent: { id: '1:1', layoutMode: 'HORIZONTAL' },
        gridRowAnchorIndex: 0,
        gridColumnAnchorIndex: 0,
      }),
    );
    expect(out.gridChild).toBeUndefined();
  });

  it('falls back to constraints when parent is not auto-layout', () => {
    const out = serializeFlatSync(
      fake({ constraints: { horizontal: 'STRETCH', vertical: 'MIN' } }),
    );
    expect(out.constraints).toEqual({ horizontal: 'STRETCH', vertical: 'MIN' });
    expect(out.layoutSizingHorizontal).toBeUndefined();
  });

  it('serializes clipsContent', () => {
    expect(serializeFlatSync(fake({ clipsContent: true })).clipsContent).toBe(true);
  });
});

describe('serializeFlat — style links / component properties', () => {
  it('collects non-empty style ids and skips empty ones', () => {
    const out = serializeFlatSync(
      fake({ fillStyleId: 'S:abc', strokeStyleId: '', effectStyleId: 'S:def' }),
    );
    expect(out.styleIds).toEqual({ fill: 'S:abc', effect: 'S:def' });
  });

  it('collapses boundVariables to flat lists of variable ids', () => {
    const out = serializeFlatSync(
      fake({
        boundVariables: {
          fills: [{ type: 'VARIABLE_ALIAS', id: 'VariableID:1' }],
          cornerRadius: { type: 'VARIABLE_ALIAS', id: 'VariableID:2' },
        },
      }),
    );
    expect(out.boundVariables).toEqual({ fills: ['VariableID:1'], cornerRadius: ['VariableID:2'] });
  });

  it('serializes instance component properties (variant / boolean / instance-swap)', () => {
    const out = serializeFlatSync(
      fake({
        type: 'INSTANCE',
        componentProperties: {
          Size: { type: 'VARIANT', value: 'lg' },
          Disabled: { type: 'BOOLEAN', value: false },
          Icon: { type: 'INSTANCE_SWAP', value: '123:456' },
        },
      }),
    );
    expect(out.componentProperties).toEqual({
      Size: { type: 'VARIANT', value: 'lg' },
      Disabled: { type: 'BOOLEAN', value: false },
      Icon: { type: 'INSTANCE_SWAP', value: '123:456' },
    });
  });
});

describe('serializeFlat — typography', () => {
  it('captures alignment / lineHeight / letterSpacing / case / decoration', () => {
    const out = serializeFlatSync(
      fake({
        type: 'TEXT',
        characters: 'Hi',
        fontSize: 14,
        fontName: { family: 'Inter', style: 'Regular' },
        textAlignHorizontal: 'CENTER',
        textAlignVertical: 'TOP',
        lineHeight: { unit: 'PIXELS', value: 20 },
        letterSpacing: { unit: 'PERCENT', value: 2 },
        textCase: 'UPPER',
        textDecoration: 'UNDERLINE',
      }),
    );
    expect(out.textAlignHorizontal).toBe('CENTER');
    expect(out.textAlignVertical).toBe('TOP');
    expect(out.lineHeight).toEqual({ unit: 'PIXELS', value: 20 });
    expect(out.letterSpacing).toEqual({ unit: 'PERCENT', value: 2 });
    expect(out.textCase).toBe('UPPER');
    expect(out.textDecoration).toBe('UNDERLINE');
  });

  it('serializes AUTO lineHeight and marks mixed values', () => {
    expect(
      serializeFlatSync(fake({ type: 'TEXT', characters: 'a', lineHeight: { unit: 'AUTO' } }))
        .lineHeight,
    ).toEqual({
      unit: 'AUTO',
    });
    const mixed = serializeFlatSync(
      fake({
        type: 'TEXT',
        characters: 'a',
        lineHeight: Symbol('figma.mixed'),
        textCase: Symbol('m'),
      }),
    );
    expect(mixed.lineHeight).toBe(MIXED);
    expect(mixed.textCase).toBe(MIXED);
  });

  it('expands per-run segments only for mixed-style text', () => {
    const segments = [
      {
        characters: 'A',
        start: 0,
        end: 1,
        fontName: { family: 'Inter', style: 'Regular' },
        fontSize: 14,
        fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 0 } }],
        textDecoration: 'NONE',
        textCase: 'ORIGINAL',
      },
      {
        characters: 'B',
        start: 1,
        end: 2,
        fontName: { family: 'Inter', style: 'Bold' },
        fontSize: 20,
        fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 1 } }],
        textDecoration: 'UNDERLINE',
        textCase: 'ORIGINAL',
      },
    ];
    const out = serializeFlatSync(
      fake({
        type: 'TEXT',
        characters: 'AB',
        fontSize: Symbol('figma.mixed'),
        fontName: { family: 'Inter', style: 'Regular' },
        getStyledTextSegments: () => segments,
      }),
    );
    expect(out.segments).toHaveLength(2);
    expect(out.segments?.[1]).toMatchObject({
      characters: 'B',
      fontName: { family: 'Inter', style: 'Bold' },
      fontSize: 20,
      textDecoration: 'UNDERLINE',
    });
    expect(out.segments?.[1]?.fills).toEqual([
      { type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 1 } },
    ]);
  });

  it('omits segments for uniform text', () => {
    const out = serializeFlatSync(
      fake({
        type: 'TEXT',
        characters: 'Hi',
        fontSize: 14,
        fontName: { family: 'Inter', style: 'Regular' },
        textCase: 'ORIGINAL',
        textDecoration: 'NONE',
        getStyledTextSegments: () => [],
      }),
    );
    expect(out.segments).toBeUndefined();
  });
});

describe('serializeTree', () => {
  it('recurses into children', async () => {
    const leaf = fake({ id: '1:3', parent: { id: '1:2' } });
    const branch = fake({ id: '1:2', type: 'FRAME', children: [leaf] });
    const root = fake({ id: '1:1', type: 'FRAME', parent: null, children: [branch] });
    const out = await serializeTree(root);
    expect(out.children).toBeDefined();
    expect(out.children?.[0]?.id).toBe('1:2');
    expect(out.children?.[0]?.children?.[0]?.id).toBe('1:3');
  });

  it('omits children when node has no children mixin', async () => {
    const out = await serializeTree(fake({ type: 'RECTANGLE' }));
    expect(out.children).toBeUndefined();
  });

  it('handles empty children array', async () => {
    const out = await serializeTree(fake({ type: 'FRAME', children: [] }));
    expect(out.children).toEqual([]);
  });
});

describe('serializeFlat (async) — mainComponent', () => {
  it('resolves the main component for an INSTANCE via getMainComponentAsync', async () => {
    const node = fake({
      type: 'INSTANCE',
      getMainComponentAsync: async () => ({ id: '10:1', name: 'Button', key: 'abc123' }),
    });
    const out = await serializeFlat(node);
    expect(out.mainComponent).toEqual({ id: '10:1', name: 'Button', key: 'abc123' });
  });

  it('carries the owning COMPONENT_SET id/name when the main component is a variant', async () => {
    const node = fake({
      type: 'INSTANCE',
      getMainComponentAsync: async () => ({
        id: '10:2',
        name: 'Size=Large, State=Hover',
        key: 'xyz',
        parent: { id: '9:1', type: 'COMPONENT_SET', name: 'Button' },
      }),
    });
    const out = await serializeFlat(node);
    expect(out.mainComponent).toEqual({
      id: '10:2',
      name: 'Size=Large, State=Hover',
      key: 'xyz',
      componentSetId: '9:1',
      componentSetName: 'Button',
    });
  });

  it('omits mainComponent for non-instances and when resolution fails', async () => {
    expect((await serializeFlat(fake({ type: 'FRAME' }))).mainComponent).toBeUndefined();
    const broken = fake({
      type: 'INSTANCE',
      getMainComponentAsync: async () => {
        throw new Error('not loaded');
      },
    });
    expect((await serializeFlat(broken)).mainComponent).toBeUndefined();
  });
});

describe('serializeEffect', () => {
  it('serializes shadows with color / offset / spread', () => {
    const out = serializeEffect({
      type: 'DROP_SHADOW',
      visible: true,
      radius: 4,
      color: { r: 0, g: 0, b: 0, a: 0.25 },
      offset: { x: 1, y: 2 },
      spread: 3,
      blendMode: 'NORMAL',
    } as unknown as Effect);
    expect(out).toEqual({
      type: 'DROP_SHADOW',
      visible: true,
      radius: 4,
      color: { r: 0, g: 0, b: 0, a: 0.25 },
      offset: { x: 1, y: 2 },
      spread: 3,
    });
  });

  it('defaults shadow spread to 0 when absent', () => {
    const out = serializeEffect({
      type: 'INNER_SHADOW',
      visible: true,
      radius: 2,
      color: { r: 1, g: 1, b: 1, a: 1 },
      offset: { x: 0, y: 0 },
      blendMode: 'NORMAL',
    } as unknown as Effect);
    expect(out.spread).toBe(0);
  });

  it('serializes blurs with only type / visible / radius', () => {
    const out = serializeEffect({
      type: 'LAYER_BLUR',
      visible: false,
      radius: 8,
    } as unknown as Effect);
    expect(out).toEqual({ type: 'LAYER_BLUR', visible: false, radius: 8 });
  });
});

describe('serializeLayoutGrid', () => {
  it('serializes a COLUMNS grid with count / gutterSize / alignment / sectionSize', () => {
    const out = serializeLayoutGrid({
      pattern: 'COLUMNS',
      visible: true,
      count: 12,
      gutterSize: 20,
      alignment: 'STRETCH',
      sectionSize: 80,
    } as unknown as LayoutGrid);
    expect(out).toEqual({
      pattern: 'COLUMNS',
      visible: true,
      count: 12,
      gutterSize: 20,
      alignment: 'STRETCH',
      sectionSize: 80,
    });
  });

  it('omits sectionSize when absent on a row/column grid', () => {
    const out = serializeLayoutGrid({
      pattern: 'ROWS',
      visible: true,
      count: 5,
      gutterSize: 10,
      alignment: 'MIN',
    } as unknown as LayoutGrid);
    expect(out.sectionSize).toBeUndefined();
  });

  it('serializes a GRID pattern with sectionSize only', () => {
    const out = serializeLayoutGrid({
      pattern: 'GRID',
      visible: true,
      sectionSize: 8,
    } as unknown as LayoutGrid);
    expect(out).toEqual({ pattern: 'GRID', visible: true, sectionSize: 8 });
  });
});
