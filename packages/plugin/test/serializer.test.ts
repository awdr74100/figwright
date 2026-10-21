import { MIXED, type SerializedNode } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  serializeEffect,
  serializeFlat,
  serializeFlatSync,
  serializeLayoutGrid,
  resultCharBudget,
  serializeFlatNodes,
  serializePaint,
  serializeTrees,
} from '../src/serializer.js';

const serializeTree = async (node: SceneNode): Promise<SerializedNode> =>
  (await serializeTrees([node])).nodes[0]!;

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
  // Measured: Figma draws a background blur only behind a node with some visible fill. With none,
  // a hidden one, or only fully transparent ones it draws nothing, while a CSS backdrop-filter
  // would still blur; at 1% opacity, or a gradient with any non-transparent stop, it blurs the
  // whole shape.
  describe('a background blur Figma does not draw', () => {
    const blur = { type: 'BACKGROUND_BLUR', visible: true, radius: 16, blurType: 'NORMAL' };
    const solid = (opacity: number, visible = true) => ({
      type: 'SOLID',
      visible,
      opacity,
      color: { r: 1, g: 1, b: 1 },
    });
    const gradient = (a0: number, a1: number) => ({
      type: 'GRADIENT_LINEAR',
      visible: true,
      opacity: 1,
      gradientTransform: [
        [1, 0, 0],
        [0, 1, 0],
      ],
      gradientStops: [
        { position: 0, color: { r: 1, g: 1, b: 1, a: a0 } },
        { position: 1, color: { r: 1, g: 1, b: 1, a: a1 } },
      ],
    });
    const drawnOf = (fills: unknown[], effects: unknown[] = [blur]) =>
      serializeFlatSync(fake({ fills, effects })).effects?.map(e => e.drawn);

    it.each([
      ['no fill', []],
      ['a fully transparent fill', [solid(0)]],
      ['a hidden fill', [solid(1, false)]],
      ['a hidden fill and a transparent one', [solid(1, false), solid(0)]],
      ['a fully transparent gradient', [gradient(0, 0)]],
    ])('marks it behind %s', (_name, fills) => {
      expect(drawnOf(fills)).toEqual([false]);
    });

    it.each([
      ['a 1% fill', [solid(0.01)]],
      ['a gradient with one non-transparent stop', [gradient(0, 0.5)]],
    ])('leaves it unmarked behind %s', (_name, fills) => {
      expect(drawnOf(fills)).toEqual([undefined]);
    });

    it('marks only the background blur, and only a visible one', () => {
      const layer = { type: 'LAYER_BLUR', visible: true, radius: 4 };
      const hidden = { ...blur, visible: false };
      expect(drawnOf([], [layer, blur, hidden])).toEqual([undefined, false, undefined]);
    });
  });

  it.each([0.6, 1])('preserves corner smoothing %s through node serialization', value => {
    expect(serializeFlatSync(fake({ cornerRadius: 12, cornerSmoothing: value }))).toMatchObject({
      cornerRadius: 12,
      cornerSmoothing: value,
    });
  });

  it('omits the default corner smoothing 0, leaving the node exactly as it serialized before', () => {
    // Nearly every node carries 0 (a circular corner); writing it out would only grow every read.
    const out = serializeFlatSync(fake({ cornerRadius: 12, cornerSmoothing: 0 }));
    expect(out).toEqual(serializeFlatSync(fake({ cornerRadius: 12 })));
    expect('cornerSmoothing' in out).toBe(false);
  });

  it('reads fresh native values on every call rather than caching across snapshots', () => {
    const parent = { id: '1:1', layoutMode: 'HORIZONTAL' };
    const node = fake({
      parent,
      opacity: 0.25,
      layoutSizingHorizontal: 'FILL',
      constraints: { horizontal: 'CENTER', vertical: 'MIN' },
    });
    const first = serializeFlatSync(node);
    parent.layoutMode = 'NONE';
    Object.assign(node, { opacity: 0.75 });
    const second = serializeFlatSync(node);
    expect(first).toMatchObject({ opacity: 0.25, layoutSizingHorizontal: 'FILL' });
    expect(first.constraints).toBeUndefined();
    expect(second).toMatchObject({
      opacity: 0.75,
      constraints: { horizontal: 'CENTER', vertical: 'MIN' },
    });
    expect(second.layoutSizingHorizontal).toBeUndefined();
  });

  it('reads native layout and scalar getters once per node snapshot', () => {
    const reads: Record<string, number> = {};
    const tracked = (target: object, key: string, value: unknown, label = key): void => {
      Object.defineProperty(target, key, {
        get: () => {
          reads[label] = (reads[label] ?? 0) + 1;
          return value;
        },
        configurable: true,
        enumerable: true,
      });
    };
    const parent = { id: '1:1' };
    tracked(parent, 'layoutMode', 'GRID', 'parent.layoutMode');
    const node = fake({ type: 'FRAME' });
    for (const [key, value] of Object.entries({
      parent,
      rotation: 12,
      opacity: 0.75,
      layoutMode: 'HORIZONTAL',
      layoutWrap: 'WRAP',
      counterAxisSpacing: 20,
      counterAxisAlignContent: 'MIN',
      minWidth: 5,
      maxWidth: 50,
      minHeight: 6,
      maxHeight: 60,
      clipsContent: true,
    }))
      tracked(node, key, value);
    const out = serializeFlatSync(node);

    expect(out).toMatchObject({
      parentId: '1:1',
      rotation: 12,
      opacity: 0.75,
      layout: {
        mode: 'HORIZONTAL',
        layoutWrap: 'WRAP',
        counterAxisSpacing: 20,
        counterAxisAlignContent: 'MIN',
      },
      minWidth: 5,
      maxWidth: 50,
      minHeight: 6,
      maxHeight: 60,
      clipsContent: true,
    });
    expect(reads).toEqual(Object.fromEntries(Object.keys(reads).map(key => [key, 1])));
  });

  it('reads each native grid dimension only once without losing tracks or placement', () => {
    const reads: Record<string, number> = {};
    const node = fake({ type: 'FRAME' });
    for (const [key, value] of Object.entries({
      layoutMode: 'GRID',
      gridRowCount: 2,
      gridColumnCount: 3,
      gridRowGap: 8,
      gridColumnGap: 12,
      gridRowSizes: [{ type: 'FIXED', value: 30 }],
      gridColumnSizes: [{ type: 'FLEX', value: 1 }],
    })) {
      Object.defineProperty(node, key, {
        get: () => {
          reads[key] = (reads[key] ?? 0) + 1;
          return value;
        },
      });
    }
    expect(serializeFlatSync(node).layout).toMatchObject({
      mode: 'GRID',
      gridRowCount: 2,
      gridColumnCount: 3,
      gridRowGap: 8,
      gridColumnGap: 12,
      gridRowSizes: [{ type: 'FIXED', value: 30 }],
      gridColumnSizes: [{ type: 'FLEX', value: 1 }],
    });
    expect(reads).toEqual(Object.fromEntries(Object.keys(reads).map(key => [key, 1])));
  });

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

  it('surfaces per-corner cornerRadii when cornerRadius is mixed (e.g. top-only rounded card)', () => {
    const out = serializeFlatSync(
      fake({
        cornerRadius: Symbol('figma.mixed'),
        topLeftRadius: 8,
        topRightRadius: 8,
        bottomRightRadius: 0,
        bottomLeftRadius: 0,
      }),
    );
    expect(out.cornerRadius).toBe(MIXED);
    expect(out.cornerRadii).toEqual({ topLeft: 8, topRight: 8, bottomRight: 0, bottomLeft: 0 });
  });

  it('omits cornerRadii when per-corner radii are unavailable (not all numeric)', () => {
    const out = serializeFlatSync(fake({ cornerRadius: Symbol('figma.mixed') }));
    expect(out.cornerRadii).toBeUndefined();
  });

  it('surfaces blendMode but omits the no-op PASS_THROUGH', () => {
    expect(serializeFlatSync(fake({ blendMode: 'MULTIPLY' })).blendMode).toBe('MULTIPLY');
    expect(serializeFlatSync(fake({ blendMode: 'PASS_THROUGH' })).blendMode).toBeUndefined();
  });

  it('surfaces isMask / maskType only for mask nodes', () => {
    const out = serializeFlatSync(fake({ isMask: true, maskType: 'ALPHA' }));
    expect(out.isMask).toBe(true);
    expect(out.maskType).toBe('ALPHA');
    expect(serializeFlatSync(fake({ isMask: false })).isMask).toBeUndefined();
  });

  it('surfaces ellipse arcData for a partial sweep (pie) or non-zero innerRadius (donut)', () => {
    // Partial sweep → a pie slice / gauge.
    const pie = serializeFlatSync(
      fake({ arcData: { startingAngle: 0, endingAngle: Math.PI, innerRadius: 0 } }),
    );
    expect(pie.arcData).toEqual({ startingAngle: 0, endingAngle: Math.PI, innerRadius: 0 });
    // Full sweep but a hole → a ring / donut.
    const donut = serializeFlatSync(
      fake({ arcData: { startingAngle: 0, endingAngle: Math.PI * 2, innerRadius: 0.6 } }),
    );
    expect(donut.arcData).toEqual({ startingAngle: 0, endingAngle: Math.PI * 2, innerRadius: 0.6 });
  });

  it('omits arcData for a plain full disc and for non-ellipse nodes', () => {
    const disc = serializeFlatSync(
      fake({ arcData: { startingAngle: 0, endingAngle: Math.PI * 2, innerRadius: 0 } }),
    );
    expect(disc.arcData).toBeUndefined();
    expect(serializeFlatSync(fake()).arcData).toBeUndefined();
  });

  it("derives a CSS angle for a linear gradient from the owning node's proportions", () => {
    // The same matrix on two differently shaped nodes: the angle must follow the node, not just the
    // matrix, or every non-square gradient is emitted rotated.
    const gradient = {
      type: 'GRADIENT_LINEAR',
      visible: true,
      opacity: 1,
      gradientStops: [
        { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
        { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
      ],
      gradientTransform: [
        [0.5, 0.5, 0],
        [0, 1, 0],
      ],
    };
    const wide = serializeFlatSync(fake({ width: 400, height: 100, fills: [gradient] }));
    const square = serializeFlatSync(fake({ width: 200, height: 200, fills: [gradient] }));
    // Both angles are what live Figma actually rendered for this matrix at these sizes.
    expect((wide.fills as readonly { cssAngle?: number }[])[0]?.cssAngle).toBe(165.96);
    expect((square.fills as readonly { cssAngle?: number }[])[0]?.cssAngle).toBe(135);
    // The matrix still ships alongside it — the write side round-trips that, not the angle.
    expect(
      (wide.fills as readonly { gradientTransform?: number[][] }[])[0]?.gradientTransform,
    ).toEqual([
      [0.5, 0.5, 0],
      [0, 1, 0],
    ]);
  });

  it('omits cssAngle for gradient types that are not an angle in CSS', () => {
    for (const type of ['GRADIENT_RADIAL', 'GRADIENT_ANGULAR', 'GRADIENT_DIAMOND']) {
      const out = serializeFlatSync(
        fake({
          width: 400,
          height: 100,
          fills: [
            {
              type,
              visible: true,
              opacity: 1,
              gradientStops: [{ position: 0, color: { r: 1, g: 0, b: 0, a: 1 } }],
              gradientTransform: [
                [0.5, 0.5, 0],
                [0, 1, 0],
              ],
            },
          ],
        }),
      );
      expect((out.fills as readonly { cssAngle?: number }[])[0]?.cssAngle).toBeUndefined();
    }
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
        // The identity matrix is a left-to-right ramp; on the 10×10 fake node that is 90deg.
        cssAngle: 90,
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

  it('carries a CROP fill’s matrix and the CSS that reproduces it, and nothing for other modes', () => {
    const image = (
      scaleMode: string,
      imageTransform: number[][],
      size = { width: 200, height: 200 },
    ) =>
      serializeFlatSync(
        fake({
          ...size,
          fills: [{ type: 'IMAGE', visible: true, opacity: 1, scaleMode, imageTransform }],
        }),
      ).fills?.[0];
    // Live-measured crops (zoomed in; offset with Figma's float32 noise). Rendered as emitted, the
    // pixel-aligned ones matched Figma exactly.
    expect(
      image('CROP', [
        [0.5, 0, 0.25],
        [0, 0.5, 0.25],
      ]),
    ).toMatchObject({
      imageTransform: [
        [0.5, 0, 0.25],
        [0, 0.5, 0.25],
      ],
      cssTransform: 'translate(-50%, -50%) scale(2, 2)',
    });
    expect(
      image('CROP', [
        [0.6000000238418579, 0, 0.4000000059604645],
        [0, 0.800000011920929, 0],
      ]),
    ).toMatchObject({
      imageTransform: [
        [0.6, 0, 0.4],
        [0, 0.8, 0],
      ],
      cssTransform: 'translate(-66.6667%, 0%) scale(1.6667, 1.25)',
    });
    // A rotated crop: its off-diagonal terms scale by the owner's aspect ratio.
    const rotated = [
      [0.5, 0.2, 0.1],
      [-0.2, 0.5, 0.3],
    ];
    expect(image('CROP', rotated)).toMatchObject({
      cssTransform: 'translate(3.4483%, -58.6207%) matrix(1.7241, 0.6897, -0.6897, 1.7241, 0, 0)',
    });
    // Rendered on a live 400×200 crop: within the 2-renderer resampling floor; without the aspect
    // correction, every pixel was off.
    expect(image('CROP', rotated, { width: 400, height: 200 })).toMatchObject({
      cssTransform: 'translate(3.4483%, -58.6207%) matrix(1.7241, 0.3448, -1.3793, 1.7241, 0, 0)',
    });
    // A matrix with no inverse has no CSS, but the matrix itself still reads.
    expect(
      image('CROP', [
        [0, 0, 0.5],
        [0, 0, 0.5],
      ]),
    ).not.toHaveProperty('cssTransform');
    // The other modes carry the identity Figma keeps, which means nothing there.
    for (const mode of ['FILL', 'FIT', 'TILE']) {
      const out = image(mode, [
        [1, 0, 0],
        [0, 1, 0],
      ]);
      expect(out).not.toHaveProperty('imageTransform');
      expect(out).not.toHaveProperty('cssTransform');
    }
  });

  it('drops a rotated crop’s CSS where there is no owner to take the aspect ratio from', () => {
    const paint = {
      type: 'IMAGE',
      visible: true,
      opacity: 1,
      scaleMode: 'CROP',
      imageTransform: [
        [0.5, 0.2, 0.1],
        [-0.2, 0.5, 0.3],
      ],
    } as unknown as Paint;
    const out = serializePaint(paint, null);
    expect(out).toHaveProperty('imageTransform');
    expect(out).not.toHaveProperty('cssTransform');
    // An unrotated crop needs no size.
    const flat = serializePaint(
      {
        ...paint,
        imageTransform: [
          [0.5, 0, 0.25],
          [0, 0.5, 0.25],
        ],
      } as unknown as Paint,
      null,
    );
    expect(flat).toMatchObject({ cssTransform: 'translate(-50%, -50%) scale(2, 2)' });
  });

  it('flags an IMAGE fill with non-zero adjustments; untouched filters stay clean', () => {
    // Adjusted: the original bytes don't carry the grading → export the composited render instead.
    const graded = serializeFlatSync(
      fake({
        fills: [
          {
            type: 'IMAGE',
            visible: true,
            opacity: 1,
            scaleMode: 'FILL',
            filters: { exposure: 0.3, contrast: 0, saturation: 0 },
          },
        ],
      }),
    );
    expect(graded.fills?.[0]).toMatchObject({ filtersApplied: true });

    // All-zero filters (Figma's default object) must NOT flag.
    const untouched = serializeFlatSync(
      fake({
        fills: [
          {
            type: 'IMAGE',
            visible: true,
            opacity: 1,
            scaleMode: 'FILL',
            filters: { exposure: 0, contrast: 0 },
          },
        ],
      }),
    );
    expect(untouched.fills?.[0]).not.toHaveProperty('filtersApplied');
  });

  it('embeds Dev Mode annotations and the sticky/aspect dimensions only when meaningful', () => {
    const out = serializeFlatSync(
      fake({
        overflowDirection: 'VERTICAL',
        numberOfFixedChildren: 2,
        targetAspectRatio: { x: 16, y: 9 },
        annotations: [{ label: 'brand colour', properties: [{ type: 'fills' }] }],
      }),
    );
    expect(out.numberOfFixedChildren).toBe(2);
    expect(out.targetAspectRatio).toEqual({ x: 16, y: 9 });
    expect(out.annotations).toEqual([{ label: 'brand colour', properties: ['fills'] }]);

    // Defaults stay omitted: 0 fixed children, no locked ratio, empty annotations.
    const defaults = serializeFlatSync(
      fake({ numberOfFixedChildren: 0, targetAspectRatio: null, annotations: [] }),
    );
    expect(defaults.numberOfFixedChildren).toBeUndefined();
    expect(defaults.targetAspectRatio).toBeUndefined();
    expect(defaults.annotations).toBeUndefined();

    // A degenerate ratio (a zero side) is dropped, not emitted as an invalid aspect-[0/9].
    const degenerate = serializeFlatSync(fake({ targetAspectRatio: { x: 0, y: 9 } }));
    expect(degenerate.targetAspectRatio).toBeUndefined();
  });

  it('serializes a PATTERN paint with its tiling geometry (source node + repeat)', () => {
    const out = serializeFlatSync(
      fake({
        fills: [
          {
            type: 'PATTERN',
            visible: false,
            opacity: 0.8,
            sourceNodeId: '12:34',
            tileType: 'RECTANGULAR',
            scalingFactor: 0.5,
            spacing: { x: 4, y: 8 },
            horizontalAlignment: 'CENTER',
          },
        ],
      }),
    );
    expect(out.fills).toEqual([
      {
        type: 'PATTERN',
        visible: false,
        opacity: 0.8,
        sourceNodeId: '12:34',
        tileType: 'RECTANGULAR',
        scalingFactor: 0.5,
        spacing: { x: 4, y: 8 },
        horizontalAlignment: 'CENTER',
      },
    ]);
  });

  it('omits the no-op pattern defaults (spacing 0,0 / alignment START)', () => {
    const out = serializeFlatSync(
      fake({
        fills: [
          {
            type: 'PATTERN',
            visible: true,
            opacity: 1,
            sourceNodeId: '12:34',
            tileType: 'RECTANGULAR',
            scalingFactor: 1,
            spacing: { x: 0, y: 0 },
            horizontalAlignment: 'START',
            verticalAlignment: 'START',
          },
        ],
      }),
    );
    expect(out.fills).toEqual([
      {
        type: 'PATTERN',
        visible: true,
        opacity: 1,
        sourceNodeId: '12:34',
        tileType: 'RECTANGULAR',
        scalingFactor: 1,
      },
    ]);
  });

  it('carries a pattern’s vertical alignment, which the typings leave out', () => {
    const out = serializeFlatSync(
      fake({
        fills: [
          {
            type: 'PATTERN',
            visible: true,
            opacity: 1,
            sourceNodeId: '12:34',
            tileType: 'RECTANGULAR',
            scalingFactor: 1,
            spacing: { x: 0, y: 0 },
            horizontalAlignment: 'START',
            verticalAlignment: 'END',
          },
        ],
      }),
    );
    expect(out.fills).toEqual([expect.objectContaining({ verticalAlignment: 'END' })]);
    expect(out.fills).toEqual([expect.not.objectContaining({ horizontalAlignment: 'START' })]);
  });

  it('serializes a SHADER paint with its id and each value named by its metadata', () => {
    const out = serializeFlatSync(
      fake({
        fills: [
          {
            type: 'SHADER',
            id: 'shader:grain',
            visible: true,
            opacity: 0.9,
            properties: {
              'def:1': 0.35,
              'def:2': { r: 1, g: 0.5, b: 0, a: 1 },
              'def:3': { type: 'VARIABLE_ALIAS', id: 'VariableID:7:1' },
            },
            propertyMetadata: {
              'def:1': {
                name: 'Intensity',
                type: 'NUMBER',
                defaultValue: 0.5,
                description: 'Grain',
              },
              'def:2': { name: 'Tint', type: 'COLOR', description: '' },
              'def:3': { name: 'Glow', type: 'COLOR' },
            },
          },
        ],
      }),
    );
    expect(out.fills).toEqual([
      {
        type: 'SHADER',
        visible: true,
        opacity: 0.9,
        shaderId: 'shader:grain',
        shaderProperties: [
          // The author's default is not what renders, so it stays out; an empty description too.
          { id: 'def:1', name: 'Intensity', type: 'NUMBER', value: 0.35, description: 'Grain' },
          { id: 'def:2', name: 'Tint', type: 'COLOR', value: { r: 1, g: 0.5, b: 0, a: 1 } },
          {
            id: 'def:3',
            name: 'Glow',
            type: 'COLOR',
            value: { type: 'VARIABLE_ALIAS', id: 'VariableID:7:1' },
          },
        ],
      },
    ]);
  });

  it('keeps a SHADER value under its bare id when Figma supplies no metadata for it', () => {
    const out = serializeFlatSync(
      fake({
        fills: [
          {
            type: 'SHADER',
            id: 'shader:wave',
            properties: { 'def:1': { x: 0.2, y: 0.4, x2: 0.8, y2: 0.6 } },
          },
        ],
      }),
    );
    expect(out.fills).toEqual([
      {
        type: 'SHADER',
        visible: true,
        opacity: 1,
        shaderId: 'shader:wave',
        shaderProperties: [{ id: 'def:1', value: { x: 0.2, y: 0.4, x2: 0.8, y2: 0.6 } }],
      },
    ]);
  });

  it('omits shaderProperties for a shader that has none', () => {
    const out = serializeFlatSync(
      fake({ fills: [{ type: 'SHADER', id: 'shader:flat', visible: true, opacity: 1 }] }),
    );
    expect(out.fills).toEqual([
      { type: 'SHADER', visible: true, opacity: 1, shaderId: 'shader:flat' },
    ]);
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

  it("carries a variable font's axis values on the node-level fontName", () => {
    const out = serializeFlatSync(
      fake({
        type: 'TEXT',
        characters: 'Hello',
        fontSize: 16,
        fontName: { family: 'Inter', style: 'Regular', variationSettings: { wght: 650, slnt: -4 } },
      }),
    );
    expect(out.fontName).toEqual({
      family: 'Inter',
      style: 'Regular',
      variationSettings: { wght: 650, slnt: -4 },
    });
  });

  it('omits variationSettings entirely for a static font (never an empty object)', () => {
    const out = serializeFlatSync(
      fake({
        type: 'TEXT',
        characters: 'Hello',
        fontSize: 16,
        fontName: { family: 'Inter', style: 'Bold' },
      }),
    );
    expect(out.fontName).toEqual({ family: 'Inter', style: 'Bold' });
    expect(Object.hasOwn(out.fontName as object, 'variationSettings')).toBe(false);
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

  it('surfaces dashPattern / non-default strokeCap / strokeJoin on a dashed stroke', () => {
    const out = serializeFlatSync(
      fake({
        strokes: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 0 } }],
        strokeWeight: 1,
        dashPattern: [4, 2],
        strokeCap: 'ROUND',
        strokeJoin: 'ROUND',
      }),
    );
    expect(out.dashPattern).toEqual([4, 2]);
    expect(out.strokeCap).toBe('ROUND');
    expect(out.strokeJoin).toBe('ROUND');
  });

  it('omits dashPattern (empty=solid) and the no-op strokeCap NONE / strokeJoin MITER', () => {
    const out = serializeFlatSync(
      fake({
        strokes: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 0 } }],
        strokeWeight: 1,
        dashPattern: [],
        strokeCap: 'NONE',
        strokeJoin: 'MITER',
      }),
    );
    expect(out.dashPattern).toBeUndefined();
    expect(out.strokeCap).toBeUndefined();
    expect(out.strokeJoin).toBeUndefined();
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

  it('carries reversed paint order and stroke-in-layout only when non-default', () => {
    const base = {
      type: 'FRAME',
      layoutMode: 'VERTICAL',
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      itemSpacing: -8,
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: 'MIN',
    };
    // The stacked-avatars shape: negative spacing + reversed z-order; strokes take layout space.
    const reversed = serializeFlatSync(
      fake({ ...base, itemReverseZIndex: true, strokesIncludedInLayout: true }),
    );
    expect(reversed.layout).toMatchObject({
      itemReverseZIndex: true,
      strokesIncludedInLayout: true,
    });

    // Defaults (false) stay omitted so an ordinary flex row stays clean.
    const plain = serializeFlatSync(
      fake({ ...base, itemReverseZIndex: false, strokesIncludedInLayout: false }),
    );
    expect(plain.layout).not.toHaveProperty('itemReverseZIndex');
    expect(plain.layout).not.toHaveProperty('strokesIncludedInLayout');
  });

  it('serializes WRAP cross-axis spacing + alignment (non-default only), skips them when not wrapping', () => {
    const base = {
      type: 'FRAME',
      layoutMode: 'HORIZONTAL',
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      itemSpacing: 8,
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: 'MIN',
    } as const;

    // WRAP with a real row gap → counterAxisSpacing surfaces; AUTO alignment is the default → omitted.
    const wrapped = serializeFlatSync(
      fake({
        ...base,
        layoutWrap: 'WRAP',
        counterAxisSpacing: 16,
        counterAxisAlignContent: 'AUTO',
      }),
    );
    expect(wrapped.layout?.counterAxisSpacing).toBe(16);
    expect(wrapped.layout?.counterAxisAlignContent).toBeUndefined();

    // SPACE_BETWEEN distributes the tracks. Figma still reports the spacing — it never returns null
    // (typings, and measured: 30 read back) — but ignores it, so only the alignment surfaces.
    const distributed = serializeFlatSync(
      fake({
        ...base,
        layoutWrap: 'WRAP',
        counterAxisSpacing: 30,
        counterAxisAlignContent: 'SPACE_BETWEEN',
      }),
    );
    expect(distributed.layout?.counterAxisSpacing).toBeUndefined();
    expect(distributed.layout?.counterAxisAlignContent).toBe('SPACE_BETWEEN');

    // A vertical wrap carries the same fields: its tracks are columns, so the spacing is a column gap.
    const column = serializeFlatSync(
      fake({
        ...base,
        layoutMode: 'VERTICAL',
        layoutWrap: 'WRAP',
        counterAxisSpacing: 30,
        counterAxisAlignContent: 'AUTO',
      }),
    );
    expect(column.layout).toMatchObject({
      mode: 'VERTICAL',
      layoutWrap: 'WRAP',
      counterAxisSpacing: 30,
    });

    // A non-wrapping flex never carries them, even if the underlying props are set.
    const noWrap = serializeFlatSync(
      fake({
        ...base,
        layoutWrap: 'NO_WRAP',
        counterAxisSpacing: 16,
        counterAxisAlignContent: 'SPACE_BETWEEN',
      }),
    );
    expect(noWrap.layout?.counterAxisSpacing).toBeUndefined();
    expect(noWrap.layout?.counterAxisAlignContent).toBeUndefined();
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

  it('reads the non-default GRID placement modes and leaves the defaults out', () => {
    const grid = (positioning: string, autoTracks: string) =>
      serializeFlatSync(
        fake({
          type: 'FRAME',
          layoutMode: 'GRID',
          gridColumnCount: 3,
          gridItemsPositioning: positioning,
          gridAutoTracks: autoTracks,
        }),
      ).layout;
    expect(grid('ROW_AUTO_FLOW', 'ROWS')).toMatchObject({
      gridItemsPositioning: 'ROW_AUTO_FLOW',
      gridAutoTracks: 'ROWS',
    });
    const defaults = grid('MANUAL', 'NONE');
    expect(defaults?.gridItemsPositioning).toBeUndefined();
    expect(defaults?.gridAutoTracks).toBeUndefined();
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

  it('captures min/max size bounds, omitting unset (null) ones', () => {
    // Bounds apply to auto-layout frames AND their children — a top-level auto-layout frame
    // (no auto-layout parent) still carries its own maxWidth, so no parent gating.
    const out = serializeFlatSync(
      fake({ minWidth: 120, maxWidth: null, minHeight: null, maxHeight: 480 }),
    );
    expect(out.minWidth).toBe(120);
    expect(out.maxWidth).toBeUndefined();
    expect(out.minHeight).toBeUndefined();
    expect(out.maxHeight).toBe(480);
  });

  it('omits min/max entirely for nodes without the properties', () => {
    const out = serializeFlatSync(fake({}));
    expect(out.minWidth).toBeUndefined();
    expect(out.maxHeight).toBeUndefined();
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

  it('omits gridChild for a child with no cell (anchor -1, default span / align)', () => {
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

  it('drops the anchors Figma reports for a child of a ROW_AUTO_FLOW grid, keeping span and align', () => {
    // Measured: a flowing grid reports each child's landed cell (0,0 / 0,1 / …), never -1.
    const parent = { id: '1:1', layoutMode: 'GRID', gridItemsPositioning: 'ROW_AUTO_FLOW' };
    const child = (extra: Record<string, unknown>) =>
      serializeFlatSync(
        fake({
          parent,
          gridRowAnchorIndex: 1,
          gridColumnAnchorIndex: 2,
          gridRowSpan: 1,
          gridColumnSpan: 1,
          ...extra,
        }),
      ).gridChild;
    expect(child({})).toBeUndefined();
    expect(child({ gridColumnSpan: 2, gridChildVerticalAlign: 'CENTER' })).toEqual({
      columnSpan: 2,
      verticalAlign: 'CENTER',
    });
    // The same cell under MANUAL is a pinned placement.
    expect(
      serializeFlatSync(
        fake({
          parent: { ...parent, gridItemsPositioning: 'MANUAL' },
          gridRowAnchorIndex: 1,
          gridColumnAnchorIndex: 2,
        }),
      ).gridChild,
    ).toEqual({ rowAnchorIndex: 1, columnAnchorIndex: 2 });
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

  it("surfaces a frame's own layoutGrids (the responsive column system)", () => {
    const out = serializeFlatSync(
      fake({
        type: 'FRAME',
        layoutGrids: [
          { pattern: 'COLUMNS', visible: true, count: 12, gutterSize: 24, alignment: 'STRETCH' },
        ],
      }),
    );
    expect(out.layoutGrids).toEqual([
      { pattern: 'COLUMNS', visible: true, count: 12, gutterSize: 24, alignment: 'STRETCH' },
    ]);
  });

  it('omits layoutGrids when the frame defines none', () => {
    expect(serializeFlatSync(fake({ type: 'FRAME', layoutGrids: [] })).layoutGrids).toBeUndefined();
  });

  it('surfaces overflowDirection on a scrolling frame, omits the NONE default', () => {
    expect(
      serializeFlatSync(fake({ type: 'FRAME', overflowDirection: 'VERTICAL' })).overflowDirection,
    ).toBe('VERTICAL');
    expect(
      serializeFlatSync(fake({ type: 'FRAME', overflowDirection: 'NONE' })).overflowDirection,
    ).toBeUndefined();
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

  it('serializes which property drives a sublayer, and only the fields that name one', () => {
    const out = serializeFlatSync(
      fake({
        type: 'TEXT',
        characters: 'Hello',
        componentPropertyReferences: { characters: 'Caption#79:0', visible: 'Show#79:1' },
      }),
    );
    expect(out.componentPropertyReferences).toEqual({
      characters: 'Caption#79:0',
      visible: 'Show#79:1',
    });
  });

  // A node outside any component carries null here, and Figma leaves the empty fields off rather
  // than setting them to '' — emitting either as a present-but-meaningless field would tell codegen
  // a layer is prop-driven when it is not.
  it('omits property references for a node that has none', () => {
    expect(serializeFlatSync(fake({ type: 'FRAME' })).componentPropertyReferences).toBeUndefined();
    expect(
      serializeFlatSync(fake({ type: 'FRAME', componentPropertyReferences: null }))
        .componentPropertyReferences,
    ).toBeUndefined();
    expect(
      serializeFlatSync(fake({ type: 'FRAME', componentPropertyReferences: { visible: '' } }))
        .componentPropertyReferences,
    ).toBeUndefined();
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

  it("derives cssAngle for a gradient text run from the TEXT node's own size", () => {
    // A run's gradient spans the whole text box, not the run — so the node's size is the right
    // reference. Without it a gradient-filled headline loses its angle the way a node fill would.
    const gradient = {
      type: 'GRADIENT_LINEAR',
      visible: true,
      opacity: 1,
      gradientStops: [
        { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
        { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
      ],
      gradientTransform: [
        [0.5, 0.5, 0],
        [0, 1, 0],
      ],
    };
    const segments = [
      {
        characters: 'A',
        start: 0,
        end: 1,
        fontName: { family: 'Inter', style: 'Regular' },
        fontSize: 20,
        fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 0 } }],
        textDecoration: 'NONE',
        textCase: 'ORIGINAL',
      },
      {
        characters: 'B',
        start: 1,
        end: 2,
        fontName: { family: 'Inter', style: 'Regular' },
        fontSize: 20,
        fills: [gradient],
        textDecoration: 'NONE',
        textCase: 'ORIGINAL',
      },
    ];
    const out = serializeFlatSync(
      fake({
        type: 'TEXT',
        width: 400,
        height: 100,
        characters: 'AB',
        fills: MIXED,
        getStyledTextSegments: () => segments,
      }),
    );
    const runFills = out.segments?.[1]?.fills as readonly { cssAngle?: number }[] | undefined;
    expect(runFills?.[0]?.cssAngle).toBe(165.96);
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

  it("carries a variable font's axis values onto each per-run segment", () => {
    // A run is where a weight override most often lives — an inline emphasis that is wght 700 of
    // the same named instance rather than a separate Bold face.
    const segments = [
      {
        characters: 'A',
        start: 0,
        end: 1,
        fontName: { family: 'Inter', style: 'Regular', variationSettings: { wght: 400 } },
        fontSize: 14,
        fills: [],
        textDecoration: 'NONE',
        textCase: 'ORIGINAL',
      },
      {
        characters: 'B',
        start: 1,
        end: 2,
        fontName: { family: 'Inter', style: 'Regular', variationSettings: { wght: 700 } },
        fontSize: 14,
        fills: [],
        textDecoration: 'NONE',
        textCase: 'ORIGINAL',
      },
    ];
    const out = serializeFlatSync(
      fake({
        type: 'TEXT',
        characters: 'AB',
        fontSize: 14,
        fontName: Symbol('figma.mixed'),
        getStyledTextSegments: () => segments,
      }),
    );
    expect(out.segments?.map(seg => seg.fontName)).toEqual([
      { family: 'Inter', style: 'Regular', variationSettings: { wght: 400 } },
      { family: 'Inter', style: 'Regular', variationSettings: { wght: 700 } },
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

  it('asks Figma for every per-run field the segment output can carry', () => {
    // Every other segment test stubs getStyledTextSegments and ignores what was requested, so a
    // field dropped from the request list stays green here while real Figma silently stops
    // returning it. This is the only assertion on the request itself.
    const getStyledTextSegments = vi.fn<(fields: readonly string[]) => unknown[]>(() => []);
    serializeFlatSync(
      fake({
        type: 'TEXT',
        characters: 'AB',
        fontSize: Symbol('figma.mixed'),
        fontName: { family: 'Inter', style: 'Regular' },
        getStyledTextSegments,
      }),
    );
    expect(getStyledTextSegments.mock.calls[0]?.[0]).toEqual([
      'fontName',
      'fontSize',
      'fills',
      'textDecoration',
      'textCase',
      'lineHeight',
      'letterSpacing',
      'hyperlink',
      'listOptions',
      'indentation',
      'textWrapStyle',
      'textStyleId',
      'fillStyleId',
      'boundVariables',
    ]);
  });

  it('emits a uniform textWrapStyle node-level, without expanding segments', () => {
    const out = serializeFlatSync(
      fake({
        type: 'TEXT',
        characters: 'A balanced heading',
        fontSize: 24,
        fontName: { family: 'Inter', style: 'Bold' },
        textCase: 'ORIGINAL',
        textDecoration: 'NONE',
        textWrapStyle: 'BALANCE',
        getStyledTextSegments: () => [],
      }),
    );
    expect(out.textWrapStyle).toBe('BALANCE');
    expect(out.segments).toBeUndefined();
  });

  it('expands segments when textWrapStyle alone is mixed, and drops the node-level value', () => {
    // Wrap style is paragraph-scoped, so two paragraphs disagreeing is enough to make the node-level
    // read `mixed` while every other dimension stays uniform — nothing else would trip
    // needsSegments, so without its own gate the real per-paragraph values would vanish entirely.
    const uniform = {
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 14,
      fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 0 } }],
      textDecoration: 'NONE',
      textCase: 'ORIGINAL',
    };
    const segments = [
      { ...uniform, characters: 'One\n', start: 0, end: 4, textWrapStyle: 'AUTO' },
      { ...uniform, characters: 'Two', start: 4, end: 7, textWrapStyle: 'BALANCE' },
    ];
    const out = serializeFlatSync(
      fake({
        type: 'TEXT',
        characters: 'One\nTwo',
        fontSize: 14,
        fontName: { family: 'Inter', style: 'Regular' },
        textCase: 'ORIGINAL',
        textDecoration: 'NONE',
        textWrapStyle: Symbol('figma.mixed'),
        getStyledTextSegments: () => segments,
      }),
    );
    expect(out.textWrapStyle).toBeUndefined();
    expect(out.segments).toHaveLength(2);
    // AUTO is the no-op → left off the run; only the deliberate value is carried.
    expect(out.segments?.[0]?.textWrapStyle).toBeUndefined();
    expect(out.segments?.[1]?.textWrapStyle).toBe('BALANCE');
  });

  it('surfaces a node-level uniform hyperlink (whole text is one link)', () => {
    const out = serializeFlatSync(
      fake({
        type: 'TEXT',
        characters: 'Docs',
        fontSize: 14,
        fontName: { family: 'Inter', style: 'Regular' },
        textCase: 'ORIGINAL',
        textDecoration: 'NONE',
        hyperlink: { type: 'URL', value: 'https://x.dev' },
        getStyledTextSegments: () => [],
      }),
    );
    expect(out.hyperlink).toEqual({ type: 'URL', value: 'https://x.dev' });
  });

  it('expands segments for a partial hyperlink even when the 5 style basics are uniform', () => {
    const segments = [
      {
        characters: 'Agree to ',
        start: 0,
        end: 9,
        fontName: { family: 'Inter', style: 'Regular' },
        fontSize: 14,
        fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 0 } }],
        textDecoration: 'NONE',
        textCase: 'ORIGINAL',
      },
      {
        characters: 'Terms',
        start: 9,
        end: 14,
        fontName: { family: 'Inter', style: 'Regular' },
        fontSize: 14,
        fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 0 } }],
        textDecoration: 'NONE',
        textCase: 'ORIGINAL',
        hyperlink: { type: 'URL', value: 'https://x.dev/terms' },
      },
    ];
    const out = serializeFlatSync(
      fake({
        type: 'TEXT',
        characters: 'Agree to Terms',
        fontSize: 14,
        fontName: { family: 'Inter', style: 'Regular' },
        textCase: 'ORIGINAL',
        textDecoration: 'NONE',
        // A partial link makes the node's hyperlink `mixed` (a symbol) → no node-level link, expand runs.
        hyperlink: Symbol('figma.mixed'),
        getStyledTextSegments: () => segments,
      }),
    );
    expect(out.hyperlink).toBeUndefined();
    expect(out.segments).toHaveLength(2);
    expect(out.segments?.[1]?.hyperlink).toEqual({ type: 'URL', value: 'https://x.dev/terms' });
    expect(out.segments?.[0]?.hyperlink).toBeUndefined();
  });

  it('expands segments for a uniform list (probed via getRangeListOptions) and carries listOptions', () => {
    const segments = [
      {
        characters: 'One\nTwo',
        start: 0,
        end: 7,
        fontName: { family: 'Inter', style: 'Regular' },
        fontSize: 14,
        fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 0 } }],
        textDecoration: 'NONE',
        textCase: 'ORIGINAL',
        listOptions: { type: 'UNORDERED' },
        indentation: 1,
      },
    ];
    const out = serializeFlatSync(
      fake({
        type: 'TEXT',
        characters: 'One\nTwo',
        fontSize: 14,
        fontName: { family: 'Inter', style: 'Regular' },
        textCase: 'ORIGINAL',
        textDecoration: 'NONE',
        getRangeListOptions: () => ({ type: 'UNORDERED' }),
        getStyledTextSegments: () => segments,
      }),
    );
    expect(out.segments).toHaveLength(1);
    expect(out.segments?.[0]?.listOptions).toBe('UNORDERED');
    expect(out.segments?.[0]?.indentation).toBe(1);
  });

  it('skips the list probe entirely for single-line text (the hot-path perf gate)', () => {
    let probed = false;
    const out = serializeFlatSync(
      fake({
        type: 'TEXT',
        characters: 'Buy now', // no newline → can't be a list → never probed
        fontSize: 14,
        fontName: { family: 'Inter', style: 'Regular' },
        textCase: 'ORIGINAL',
        textDecoration: 'NONE',
        getRangeListOptions: () => {
          probed = true;
          return { type: 'UNORDERED' };
        },
        getStyledTextSegments: () => [],
      }),
    );
    expect(probed).toBe(false);
    expect(out.segments).toBeUndefined();
  });

  it('probes multi-line text but expands no segments when it is not a list (NONE)', () => {
    let probed = false;
    const out = serializeFlatSync(
      fake({
        type: 'TEXT',
        characters: 'line one\nline two', // multi-line, but a plain paragraph, not a list
        fontSize: 14,
        fontName: { family: 'Inter', style: 'Regular' },
        textCase: 'ORIGINAL',
        textDecoration: 'NONE',
        getRangeListOptions: () => {
          probed = true;
          return { type: 'NONE' };
        },
        getStyledTextSegments: () => [],
      }),
    );
    expect(probed).toBe(true);
    expect(out.segments).toBeUndefined();
  });

  it('carries per-run lineHeight only when non-default, never a mixed marker', () => {
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
        lineHeight: { unit: 'PIXELS', value: 22 },
      },
      {
        characters: 'B',
        start: 1,
        end: 2,
        fontName: { family: 'Inter', style: 'Bold' },
        fontSize: 14,
        fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 0 } }],
        textDecoration: 'NONE',
        textCase: 'ORIGINAL',
        lineHeight: { unit: 'AUTO' },
      },
    ];
    const out = serializeFlatSync(
      fake({
        type: 'TEXT',
        characters: 'AB',
        fontName: Symbol('figma.mixed'),
        fontSize: 14,
        textCase: 'ORIGINAL',
        textDecoration: 'NONE',
        getStyledTextSegments: () => segments,
      }),
    );
    expect(out.segments?.[0]?.lineHeight).toEqual({ unit: 'PIXELS', value: 22 });
    // AUTO leading is the no-op → omitted, never emitted as `mixed`.
    expect(out.segments?.[1]?.lineHeight).toBeUndefined();
  });

  it('carries per-run token bindings (styleIds + boundVariables) on a mixed run', () => {
    const segments = [
      {
        characters: 'Agree to ',
        start: 0,
        end: 9,
        fontName: { family: 'Inter', style: 'Regular' },
        fontSize: 14,
        fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 0 } }],
        textDecoration: 'NONE',
        textCase: 'ORIGINAL',
        textStyleId: '',
        fillStyleId: '',
      },
      {
        characters: 'Terms',
        start: 9,
        end: 14,
        fontName: { family: 'Inter', style: 'Bold' },
        fontSize: 14,
        fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0.4, b: 1 } }],
        textDecoration: 'UNDERLINE',
        textCase: 'ORIGINAL',
        // The link run binds a shared text style, a fill style, and a colour variable.
        textStyleId: 'S:link,',
        fillStyleId: 'S:brandfill,',
        boundVariables: { fills: { type: 'VARIABLE_ALIAS', id: 'VariableID:primary' } },
      },
    ];
    const out = serializeFlatSync(
      fake({
        type: 'TEXT',
        characters: 'Agree to Terms',
        fontName: Symbol('figma.mixed'),
        fontSize: 14,
        textCase: 'ORIGINAL',
        textDecoration: Symbol('figma.mixed'),
        getStyledTextSegments: () => segments,
      }),
    );
    // The plain run carries no bindings (empty ids omitted).
    expect(out.segments?.[0]?.styleIds).toBeUndefined();
    expect(out.segments?.[0]?.boundVariables).toBeUndefined();
    // The link run carries its style ids (raw, incl. Figma's trailing comma) + variable id list.
    expect(out.segments?.[1]?.styleIds).toEqual({ text: 'S:link,', fill: 'S:brandfill,' });
    expect(out.segments?.[1]?.boundVariables).toEqual({ fills: ['VariableID:primary'] });
  });
});

describe('serializeFlatNodes — result budget', () => {
  const nodes = Array.from({ length: 30 }, (_, i) => fake({ id: `2:${i}`, name: `Node ${i}` }));
  const exactChars = async (): Promise<number> => {
    const all = await serializeFlatNodes(nodes);
    return all.nodes.reduce((sum, n) => sum + JSON.stringify(n).length + 1, 0);
  };

  it('never stops a run that fits, even exactly', async () => {
    const run = await serializeFlatNodes(nodes, { limit: await exactChars(), used: 0 });
    expect(run.complete).toBe(true);
    expect(run.nodes.map(n => n.id)).toEqual(nodes.map(n => n.id));
  });

  it('stops a run that cannot fit, keeping an in-order prefix past the budget', async () => {
    const budget = Math.floor((await exactChars()) / 2);
    const run = await serializeFlatNodes(nodes, { limit: budget, used: 0 });
    expect(run.complete).toBe(false);
    expect(run.nodes.map(n => n.id)).toEqual(nodes.slice(0, run.nodes.length).map(n => n.id));
    // A prefix that already passes the budget — enough for the server to fill it exactly.
    expect(run.nodes.reduce((sum, n) => sum + JSON.stringify(n).length + 1, 0)).toBeGreaterThan(
      budget,
    );
  });

  it('draws several runs from one shared allowance', async () => {
    const half = Math.floor((await exactChars()) / 2);
    // Each run alone fits the limit; together they do not — so one shared allowance stops them.
    const shared = { limit: half + 10, used: 0 };
    const [a, b] = await Promise.all([
      serializeFlatNodes(nodes.slice(0, 15), shared),
      serializeFlatNodes(nodes.slice(15), shared),
    ]);
    expect(a.complete && b.complete).toBe(false);
    expect(shared.used).toBeGreaterThan(shared.limit);
    // Separately, each half fits an allowance of the same size.
    const alone = await serializeFlatNodes(nodes.slice(0, 15), { limit: half + 10, used: 0 });
    expect(alone.complete).toBe(true);
  });

  it('caps a single tool result at the client message limit, less only the envelope', () => {
    const budget = resultCharBudget();
    expect(budget.used).toBe(0);
    expect(budget.limit).toBeGreaterThan(10 * 1024 * 1024 - 64 * 1024);
    expect(budget.limit).toBeLessThan(10 * 1024 * 1024);
  });
});

describe('serializeTrees', () => {
  it('rebuilds the tree in order, children last and after mainComponent, empty arrays kept', async () => {
    const leaf = fake({ id: '1:3', type: 'TEXT' });
    const empty = fake({ id: '1:4', type: 'FRAME', children: [] });
    const instance = fake({
      id: '1:2',
      type: 'INSTANCE',
      children: [leaf, empty],
      getMainComponentAsync: async () => ({ id: '9:1', name: 'Card', key: 'card', parent: null }),
    });
    const run = await serializeTrees([instance, fake({ id: '1:5' })]);
    expect(run.complete).toBe(true);
    expect(run.total).toBe(4);
    expect(run.nodes.map(n => n.id)).toEqual(['1:2', '1:5']);
    const [root] = run.nodes;
    expect(Object.keys(root!).slice(-2)).toEqual(['mainComponent', 'children']);
    expect(root!.children!.map(n => n.id)).toEqual(['1:3', '1:4']);
    expect(root!.children![0]!.children).toBeUndefined();
    expect(root!.children![1]!.children).toEqual([]);
  });

  it('returns no partial tree when the budget stops it', async () => {
    const root = fake({
      id: '1:2',
      type: 'FRAME',
      children: Array.from({ length: 10 }, (_, i) => fake({ id: `2:${i}` })),
    });
    const run = await serializeTrees([root], { limit: 100, used: 0 });
    expect(run).toEqual({ nodes: [], complete: false, total: 11 });
  });
});

describe('serializeTree', () => {
  it('materializes a wide native children array once, preserving all siblings and order', async () => {
    const children = Array.from({ length: 1025 }, (_, index) => fake({ id: `2:${index}` }));
    let reads = 0;
    const root = fake({ type: 'FRAME' });
    Object.defineProperty(root, 'children', {
      get: () => {
        reads += 1;
        return children.slice();
      },
    });
    const out = await serializeTree(root);
    expect(out.children?.map(child => child.id)).toEqual(children.map(child => child.id));
    expect(reads).toBe(1);
  });

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
    const out = serializeEffect(
      {
        type: 'DROP_SHADOW',
        visible: true,
        radius: 4,
        color: { r: 0, g: 0, b: 0, a: 0.25 },
        offset: { x: 1, y: 2 },
        spread: 3,
        blendMode: 'NORMAL',
      } as unknown as Effect,
      null,
    );
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
    const out = serializeEffect(
      {
        type: 'INNER_SHADOW',
        visible: true,
        radius: 2,
        color: { r: 1, g: 1, b: 1, a: 1 },
        offset: { x: 0, y: 0 },
        blendMode: 'NORMAL',
      } as unknown as Effect,
      null,
    );
    expect(out.spread).toBe(0);
  });

  it('serializes blurs with only type / visible / radius', () => {
    const out = serializeEffect(
      {
        type: 'LAYER_BLUR',
        visible: false,
        radius: 8,
      } as unknown as Effect,
      null,
    );
    expect(out).toEqual({ type: 'LAYER_BLUR', visible: false, radius: 8 });
  });

  it('serializes a SHADER effect with its id and named values', () => {
    const out = serializeEffect(
      {
        type: 'SHADER',
        visible: true,
        id: 'shader:glow',
        properties: { 'def:1': true },
        propertyMetadata: { 'def:1': { name: 'Animate', type: 'BOOLEAN' } },
      } as unknown as Effect,
      null,
    );
    expect(out).toEqual({
      type: 'SHADER',
      visible: true,
      shaderId: 'shader:glow',
      shaderProperties: [{ id: 'def:1', name: 'Animate', type: 'BOOLEAN', value: true }],
    });
  });

  // The objects below are what Figma reported back for effects written through the API.
  describe('glass, texture, progressive blur and shadow flags', () => {
    it('reads a GLASS effect panel by panel, splay included though the typings omit it', () => {
      const out = serializeEffect(
        {
          type: 'GLASS',
          visible: true,
          radius: 4,
          boundVariables: {},
          refraction: 0.800000011920929,
          depth: 20,
          lightAngle: -45,
          lightIntensity: 0.6000000238418579,
          dispersion: 0.30000001192092896,
          splay: 0.5,
        } as unknown as Effect,
        null,
      );
      expect(out).toEqual({
        type: 'GLASS',
        visible: true,
        radius: 4,
        lightIntensity: 0.6000000238418579,
        lightAngle: -45,
        refraction: 0.800000011920929,
        depth: 20,
        dispersion: 0.30000001192092896,
        splay: 0.5,
      });
    });

    it('leaves splay out where Figma reports null (a glass never given one)', () => {
      const out = serializeEffect(
        {
          type: 'GLASS',
          visible: true,
          radius: 4,
          refraction: 0,
          depth: 1,
          lightAngle: 0,
          lightIntensity: 0,
          dispersion: 0,
          splay: null,
        } as unknown as Effect,
        null,
      );
      expect(out).not.toHaveProperty('splay');
    });

    it('reads a TEXTURE by its grain on each axis, its displacement and its clipping', () => {
      const out = serializeEffect(
        {
          type: 'TEXTURE',
          visible: true,
          radius: 3,
          boundVariables: {},
          noiseSize: 6,
          noiseSizeVector: { x: 6, y: 12 },
          clipToShape: true,
        } as unknown as Effect,
        null,
      );
      expect(out).toEqual({
        type: 'TEXTURE',
        visible: true,
        radius: 3,
        noiseSizeVector: { x: 6, y: 12 },
        clipToShape: true,
      });
    });

    it('reads a progressive blur ramp, with ready CSS when the node size is known', () => {
      const blur = {
        type: 'BACKGROUND_BLUR',
        visible: true,
        radius: 16,
        boundVariables: {},
        blurType: 'PROGRESSIVE',
        startRadius: 0,
        startOffset: { x: 0, y: 0.5 },
        endOffset: { x: 1, y: 0.5 },
      } as unknown as Effect;
      const out = serializeEffect(blur, { width: 200, height: 200 });
      expect(out).toMatchObject({
        type: 'BACKGROUND_BLUR',
        radius: 16,
        blurType: 'PROGRESSIVE',
        startRadius: 0,
        startOffset: { x: 0, y: 0.5 },
        endOffset: { x: 1, y: 0.5 },
      });
      expect(out.cssLayers).toHaveLength(4);
      // An effect style has no node: the ramp is still read, the CSS is not invented.
      const styled = serializeEffect(blur, null);
      expect(styled.blurType).toBe('PROGRESSIVE');
      expect(styled).not.toHaveProperty('cssLayers');
    });

    // Every blur written before progressive blurs existed reads blurType NORMAL; its output must be
    // exactly what it always was.
    it.each(['LAYER_BLUR', 'BACKGROUND_BLUR'] as const)(
      'reads a normal %s exactly as before',
      type => {
        const out = serializeEffect(
          {
            type,
            visible: true,
            radius: 8,
            boundVariables: {},
            blurType: 'NORMAL',
          } as unknown as Effect,
          { width: 100, height: 100 },
        );
        expect(out).toStrictEqual({ type, visible: true, radius: 8 });
      },
    );

    it('marks a drop shadow that shows behind the node, and a blend that is not normal', () => {
      const out = serializeEffect(
        {
          type: 'DROP_SHADOW',
          visible: true,
          radius: 12,
          boundVariables: {},
          color: { r: 0, g: 0, b: 0, a: 0.5 },
          offset: { x: 0, y: 8 },
          spread: 0,
          blendMode: 'MULTIPLY',
          showShadowBehindNode: true,
        } as unknown as Effect,
        null,
      );
      expect(out).toMatchObject({ showShadowBehindNode: true, blendMode: 'MULTIPLY' });
    });

    // A plain box-shadow already draws Figma's false, so false adds nothing to the output.
    it('reads a default shadow exactly as before', () => {
      const out = serializeEffect(
        {
          type: 'DROP_SHADOW',
          visible: true,
          radius: 4,
          boundVariables: {},
          color: { r: 0, g: 0, b: 0, a: 0.25 },
          offset: { x: 1, y: 2 },
          spread: 3,
          blendMode: 'NORMAL',
          showShadowBehindNode: false,
        } as unknown as Effect,
        null,
      );
      expect(out).toStrictEqual({
        type: 'DROP_SHADOW',
        visible: true,
        radius: 4,
        color: { r: 0, g: 0, b: 0, a: 0.25 },
        offset: { x: 1, y: 2 },
        spread: 3,
      });
    });
  });

  // The three noise objects below are what Figma reported for real effects set from the Noise
  // panel: the keys are exactly theirs, with no `blendMode` — not even after one was picked.
  describe('NOISE', () => {
    it('reads a MONOTONE noise with a different size on each axis', () => {
      const out = serializeEffect(
        {
          type: 'NOISE',
          visible: true,
          boundVariables: {},
          noiseSize: 5,
          noiseSizeVector: { x: 5, y: 10 },
          noiseType: 'MONOTONE',
          color: { r: 0, g: 0, b: 0, a: 0.25 },
          density: 60,
        } as unknown as Effect,
        null,
      );
      expect(out).toEqual({
        type: 'NOISE',
        visible: true,
        noiseType: 'MONOTONE',
        // The scalar `noiseSize` is the X alone: reading it would make this 5 × 5.
        noiseSizeVector: { x: 5, y: 10 },
        // Reported as is: a number variable with the value 60 was bound to the density.
        density: 60,
        color: { r: 0, g: 0, b: 0, a: 0.25 },
      });
    });

    it('reads a DUOTONE noise with both colours, and no colour space beside them', () => {
      const out = serializeEffect(
        {
          type: 'NOISE',
          visible: true,
          boundVariables: {},
          noiseSize: 0.5,
          noiseSizeVector: { x: 0.5, y: 0.5 },
          noiseType: 'DUOTONE',
          color: {
            r: 0.4,
            g: 0.06,
            b: 0.06,
            a: 0.25,
            sourceColor: { space: 'HSL', h: 0, s: 0.74, l: 0.23 },
          },
          secondaryColor: { r: 1, g: 1, b: 1, a: 0.25 },
          density: 1,
        } as unknown as Effect,
        null,
      );
      expect(out).toEqual({
        type: 'NOISE',
        visible: true,
        noiseType: 'DUOTONE',
        noiseSizeVector: { x: 0.5, y: 0.5 },
        density: 1,
        color: { r: 0.4, g: 0.06, b: 0.06, a: 0.25 },
        secondaryColor: { r: 1, g: 1, b: 1, a: 0.25 },
      });
    });

    it('reads a MULTITONE noise by its opacity, leaving out the colour it has no setting for', () => {
      const out = serializeEffect(
        {
          type: 'NOISE',
          visible: true,
          boundVariables: {},
          noiseSize: 4.5,
          noiseSizeVector: { x: 4.5, y: 4.5 },
          noiseType: 'MULTITONE',
          // Stayed at 0.25 while the panel's opacity moved to 70%: not a setting.
          color: { r: 0, g: 0, b: 0, a: 0.25 },
          opacity: 0.699999988079071,
          density: 1,
        } as unknown as Effect,
        null,
      );
      expect(out).toEqual({
        type: 'NOISE',
        visible: true,
        noiseType: 'MULTITONE',
        noiseSizeVector: { x: 4.5, y: 4.5 },
        density: 1,
        opacity: 0.699999988079071,
      });
    });

    it('falls back to the scalar size on both axes when no vector is reported', () => {
      const out = serializeEffect(
        {
          type: 'NOISE',
          visible: true,
          noiseSize: 2,
          noiseType: 'MONOTONE',
          color: { r: 0, g: 0, b: 0, a: 1 },
          density: 0.5,
        } as unknown as Effect,
        null,
      );
      expect(out.noiseSizeVector).toEqual({ x: 2, y: 2 });
    });
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

  it('surfaces a non-zero offset (the page margin) on a row/column grid', () => {
    const out = serializeLayoutGrid({
      pattern: 'COLUMNS',
      visible: true,
      count: 12,
      gutterSize: 24,
      alignment: 'STRETCH',
      offset: 32,
    } as unknown as LayoutGrid);
    expect(out.offset).toBe(32);
  });

  it('omits offset when it is 0 or when alignment is CENTER (which ignores it)', () => {
    const zero = serializeLayoutGrid({
      pattern: 'COLUMNS',
      visible: true,
      count: 12,
      gutterSize: 24,
      alignment: 'STRETCH',
      offset: 0,
    } as unknown as LayoutGrid);
    expect(zero.offset).toBeUndefined();

    const centered = serializeLayoutGrid({
      pattern: 'COLUMNS',
      visible: true,
      count: 12,
      gutterSize: 24,
      alignment: 'CENTER',
      offset: 32,
    } as unknown as LayoutGrid);
    expect(centered.offset).toBeUndefined();
  });
});

// Variable bindings live ON the paint / stop / effect / grid, not in the owning node's
// `boundVariables` — so dropping them made a variable-driven colour indistinguishable from a
// hard-coded one (issue #164). The raw shapes below are the ones a live Figma file actually
// returns (measured against the plugin API, not inferred): an alias object per field, and — the
// detail a hand-written fixture would never guess — `boundVariables: {}` on an UNBOUND paint,
// which must not turn into an empty field in the payload.
describe('serializer — variable bindings on paints / effects / grids', () => {
  const ALIAS = { type: 'VARIABLE_ALIAS', id: 'VariableID:5157:5005' };
  const ALIAS2 = { type: 'VARIABLE_ALIAS', id: 'VariableID:5157:5006' };

  it('carries a bound colour on a solid paint', () => {
    const out = serializePaint(
      {
        type: 'SOLID',
        visible: true,
        opacity: 1,
        blendMode: 'NORMAL',
        color: { r: 0.1, g: 0.2, b: 0.3 },
        boundVariables: { color: ALIAS },
      } as unknown as Paint,
      null,
    );
    expect(out).toEqual({
      type: 'SOLID',
      visible: true,
      opacity: 1,
      color: { r: 0.1, g: 0.2, b: 0.3 },
      boundVariables: { color: 'VariableID:5157:5005' },
    });
  });

  it('omits the field on an unbound paint, including Figma’s empty boundVariables', () => {
    const empty = serializePaint(
      {
        type: 'SOLID',
        visible: true,
        opacity: 1,
        color: { r: 0, g: 1, b: 0 },
        boundVariables: {},
      } as unknown as Paint,
      null,
    );
    expect(empty).not.toHaveProperty('boundVariables');
    const absent = serializePaint(
      {
        type: 'SOLID',
        visible: true,
        opacity: 1,
        color: { r: 0, g: 1, b: 0 },
      } as unknown as Paint,
      null,
    );
    expect(absent).not.toHaveProperty('boundVariables');
  });

  it('binds gradient stops independently of each other', () => {
    const out = serializePaint(
      {
        type: 'GRADIENT_LINEAR',
        visible: true,
        opacity: 1,
        gradientTransform: [
          [1, 0, 0],
          [0, 1, 0],
        ],
        gradientStops: [
          { position: 0, color: { r: 0, g: 0, b: 0, a: 1 }, boundVariables: { color: ALIAS } },
          { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
        ],
      } as unknown as Paint,
      null,
    ) as { gradientStops: { boundVariables?: unknown }[] };
    expect(out.gradientStops[0]?.boundVariables).toEqual({ color: 'VariableID:5157:5005' });
    expect(out.gradientStops[1]).not.toHaveProperty('boundVariables');
  });

  it('carries every bound field on a shadow', () => {
    const out = serializeEffect(
      {
        type: 'DROP_SHADOW',
        visible: true,
        radius: 24,
        color: { r: 0.1, g: 0.2, b: 0.3, a: 1 },
        offset: { x: 0, y: 2 },
        spread: 0,
        blendMode: 'NORMAL',
        boundVariables: { color: ALIAS, radius: ALIAS2 },
      } as unknown as Effect,
      null,
    );
    expect(out.boundVariables).toEqual({
      color: 'VariableID:5157:5005',
      radius: 'VariableID:5157:5006',
    });
    // The resolved literal stays alongside the binding — it is the fallback, not a replacement.
    expect(out.color).toEqual({ r: 0.1, g: 0.2, b: 0.3, a: 1 });
  });

  it('carries a bound radius on a blur (the non-shadow branch)', () => {
    const out = serializeEffect(
      {
        type: 'LAYER_BLUR',
        visible: true,
        radius: 8,
        boundVariables: { radius: ALIAS2 },
      } as unknown as Effect,
      null,
    );
    expect(out).toEqual({
      type: 'LAYER_BLUR',
      visible: true,
      radius: 8,
      boundVariables: { radius: 'VariableID:5157:5006' },
    });
  });

  it('carries bindings on both layout-grid branches', () => {
    const columns = serializeLayoutGrid({
      pattern: 'COLUMNS',
      visible: true,
      count: 12,
      gutterSize: 24,
      alignment: 'STRETCH',
      offset: 24,
      boundVariables: { gutterSize: ALIAS2 },
    } as unknown as LayoutGrid);
    expect(columns.boundVariables).toEqual({ gutterSize: 'VariableID:5157:5006' });
    const uniform = serializeLayoutGrid({
      pattern: 'GRID',
      visible: true,
      sectionSize: 8,
      boundVariables: { sectionSize: ALIAS2 },
    } as unknown as LayoutGrid);
    expect(uniform.boundVariables).toEqual({ sectionSize: 'VariableID:5157:5006' });
  });

  it('ignores a malformed alias rather than emitting a broken id', () => {
    const out = serializeEffect(
      {
        type: 'LAYER_BLUR',
        visible: true,
        radius: 8,
        // Three ways an alias can fail to be one: no id at all, a non-string id, and a null entry.
        boundVariables: {
          radius: { type: 'VARIABLE_ALIAS' },
          spread: { type: 'VARIABLE_ALIAS', id: 123 },
          color: null,
        },
      } as unknown as Effect,
      null,
    );
    expect(out).not.toHaveProperty('boundVariables');
  });

  it('keeps the well-formed bindings when a sibling field is malformed', () => {
    const out = serializeEffect(
      {
        type: 'LAYER_BLUR',
        visible: true,
        radius: 8,
        boundVariables: { radius: ALIAS2, color: { type: 'VARIABLE_ALIAS', id: 123 } },
      } as unknown as Effect,
      null,
    );
    expect(out.boundVariables).toEqual({ radius: 'VariableID:5157:5006' });
  });

  it('surfaces a bound fill through a node, alongside the node’s own coarse binding list', () => {
    const out = serializeFlatSync(
      fake({
        fills: [
          {
            type: 'SOLID',
            visible: true,
            opacity: 1,
            color: { r: 0.1, g: 0.2, b: 0.3 },
            boundVariables: { color: ALIAS },
          },
        ],
        boundVariables: { fills: [ALIAS] },
      }),
    );
    // The node-level list says *some* variable is bound; the paint says which field of which paint.
    expect(out.boundVariables).toEqual({ fills: ['VariableID:5157:5005'] });
    expect(out.fills).toEqual([
      {
        type: 'SOLID',
        visible: true,
        opacity: 1,
        color: { r: 0.1, g: 0.2, b: 0.3 },
        boundVariables: { color: 'VariableID:5157:5005' },
      },
    ]);
  });
});

describe('orientation', () => {
  const mirrored = [
    [-1, 0, 100],
    [0, 1, 0],
  ];

  it('reports a mirrored node, and how to place it', () => {
    const out = serializeFlatSync(
      fake({ type: 'RECTANGLE', rotation: -180, relativeTransform: mirrored }),
    );
    expect(out).toMatchObject({ flipped: true, cssTransform: 'scaleX(-1)' });
  });

  it('writes a turned repeat group’s copies in its parent’s axes', () => {
    const turned = [
      [0, 1, 0],
      [-1, 0, 0],
    ];
    const out = serializeFlatSync(
      fake({
        type: 'TRANSFORM_GROUP',
        rotation: 90,
        relativeTransform: turned,
        absoluteTransform: turned,
        absoluteBoundingBox: { x: 0, y: -10, width: 10, height: 10 },
        absoluteRenderBounds: { x: 0, y: -30, width: 10, height: 30 },
        transformModifiers: [
          {
            type: 'REPEAT',
            repeatType: 'LINEAR',
            axis: 'HORIZONTAL',
            unitType: 'PIXELS',
            offset: 20,
            count: 2,
          },
        ],
        children: [{ width: 10, height: 10, absoluteTransform: turned }],
      }),
    );
    expect(out.repeatTransforms).toEqual(['translate(0px, -20px)']);
  });

  it.each(['GROUP', 'TRANSFORM_GROUP'])(
    'leaves a %s’s turn to its children, which already carry it',
    type => {
      const out = serializeFlatSync(
        fake({ type, rotation: -180, relativeTransform: mirrored, children: [] }),
      );
      expect(out.flipped).toBeUndefined();
      expect(out.cssTransform).toBeUndefined();
    },
  );
});

describe('Figma Draw nodes', () => {
  const at = (x: number, y: number) => [
    [1, 0, x],
    [0, 1, y],
  ];

  it('reads a repeat group: its modifiers, every copy, and the box the copies paint into', () => {
    const out = serializeFlatSync(
      fake({
        type: 'TRANSFORM_GROUP',
        x: 20,
        y: 20,
        width: 72,
        height: 24,
        absoluteTransform: at(20, 20),
        absoluteBoundingBox: { x: 20, y: 20, width: 72, height: 24 },
        absoluteRenderBounds: { x: 20, y: 20, width: 72, height: 24 },
        transformModifiers: [
          {
            type: 'REPEAT',
            repeatType: 'LINEAR',
            axis: 'HORIZONTAL',
            unitType: 'RELATIVE',
            offset: 0.5,
            count: 5,
          },
        ],
        children: [{ width: 24, height: 24, absoluteTransform: at(20, 20) }],
      }),
    );
    expect(out.transformModifiers).toEqual([
      {
        type: 'REPEAT',
        repeatType: 'LINEAR',
        axis: 'HORIZONTAL',
        unitType: 'RELATIVE',
        offset: 0.5,
        count: 5,
      },
    ]);
    expect(out.repeatTransforms).toEqual([
      'translate(12px, 0px)',
      'translate(24px, 0px)',
      'translate(36px, 0px)',
      'translate(48px, 0px)',
    ]);
    // The render matches the box, so there is no separate painted box to report.
    expect(out.renderBounds).toBeUndefined();
  });

  it('reads a repeat group inside an instance off its main component’s node, which keeps them', async () => {
    const modifiers = [
      { type: 'REPEAT', repeatType: 'RADIAL', unitType: 'PIXELS', offset: 40, count: 4 },
    ];
    const getNodeByIdAsync = vi.fn<(id: string) => Promise<unknown>>(async id =>
      id === '16:1183' ? { type: 'TRANSFORM_GROUP', transformModifiers: modifiers } : null,
    );
    vi.stubGlobal('figma', { getNodeByIdAsync });
    try {
      const group = (id: string) =>
        fake({
          id,
          type: 'TRANSFORM_GROUP',
          width: 20,
          height: 20,
          absoluteTransform: at(0, 0),
          absoluteBoundingBox: { x: 0, y: 0, width: 20, height: 20 },
          absoluteRenderBounds: { x: 0, y: 0, width: 20, height: 20 },
          // What Figma reports inside an instance, though the copies are drawn.
          transformModifiers: [],
          children: [{ width: 20, height: 20, absoluteTransform: at(0, 0) }],
        });
      const inInstance = await serializeFlat(group('I16:1186;16:1183'));
      expect(getNodeByIdAsync).toHaveBeenCalledWith('16:1183');
      expect(inInstance.transformModifiers).toEqual(modifiers);
      expect(inInstance.repeatTransforms).toHaveLength(3);
      // A group outside any instance that has no modifiers really has none.
      getNodeByIdAsync.mockClear();
      expect((await serializeFlat(group('5:5'))).transformModifiers).toBeUndefined();
      expect(getNodeByIdAsync).not.toHaveBeenCalled();
      // A main component out of reach leaves the read as it was.
      getNodeByIdAsync.mockRejectedValueOnce(new Error('library not loaded'));
      expect((await serializeFlat(group('I1:1;2:2'))).transformModifiers).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reads text set along a path, with no corner radius it never draws', () => {
    const getStyledTextSegments = vi.fn<() => unknown[]>(() => []);
    const out = serializeFlatSync(
      fake({
        type: 'TEXT_PATH',
        width: 200,
        height: 200,
        cornerRadius: Symbol('mixed'),
        fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 0 } }],
        characters: 'Round and round',
        fontSize: 18,
        fontName: { family: 'Inter', style: 'Bold' },
        letterSpacing: { unit: 'PERCENT', value: 8 },
        textCase: 'UPPER',
        textAlignHorizontal: 'CENTER',
        textAlignVertical: 'BOTTOM',
        hyperlink: null,
        textPathStartData: { segment: 3, position: 0.5 },
        absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 },
        absoluteRenderBounds: { x: -10, y: -12, width: 220, height: 160 },
        getStyledTextSegments,
      }),
    );
    expect(out).toMatchObject({
      characters: 'Round and round',
      fontSize: 18,
      fontName: { family: 'Inter', style: 'Bold' },
      letterSpacing: { unit: 'PERCENT', value: 8 },
      textCase: 'UPPER',
      textAlignHorizontal: 'CENTER',
      textAlignVertical: 'BOTTOM',
      textPathStartData: { segment: 3, position: 0.5 },
      renderBounds: { x: -10, y: -12, width: 220, height: 160 },
    });
    for (const absent of [
      'cornerRadius',
      'lineHeight',
      'textDecoration',
      'textAutoResize',
      'segments',
    ]) {
      expect(out).not.toHaveProperty(absent);
    }
    expect(getStyledTextSegments).not.toHaveBeenCalled();
  });

  it('omits a path’s start at its very beginning', () => {
    const out = serializeFlatSync(
      fake({
        type: 'TEXT_PATH',
        characters: 'x',
        fontSize: 12,
        fontName: { family: 'Inter', style: 'Regular' },
        letterSpacing: { unit: 'PERCENT', value: 0 },
        textCase: 'ORIGINAL',
        textAlignHorizontal: 'LEFT',
        textAlignVertical: 'TOP',
        hyperlink: null,
        textPathStartData: { segment: 0, position: 0 },
      }),
    );
    expect(out).not.toHaveProperty('textPathStartData');
  });

  it('splits mixed text on a path only on what it draws, and never reports a decoration', () => {
    const getStyledTextSegments = vi.fn<(fields: string[]) => unknown[]>(fields => {
      void fields;
      return [
        {
          characters: 'Ro',
          start: 0,
          end: 2,
          fontName: { family: 'Inter', style: 'Bold' },
          fontSize: 18,
          fills: [],
          textCase: 'ORIGINAL',
          letterSpacing: { unit: 'PERCENT', value: 0 },
        },
        {
          characters: 'und',
          start: 2,
          end: 5,
          fontName: { family: 'Inter', style: 'Regular' },
          fontSize: 18,
          fills: [],
          textCase: 'ORIGINAL',
          letterSpacing: { unit: 'PERCENT', value: 0 },
        },
      ];
    });
    const out = serializeFlatSync(
      fake({
        type: 'TEXT_PATH',
        characters: 'Round',
        fontSize: 18,
        fontName: Symbol('mixed'),
        letterSpacing: { unit: 'PERCENT', value: 0 },
        textCase: 'ORIGINAL',
        textAlignHorizontal: 'LEFT',
        textAlignVertical: 'TOP',
        hyperlink: null,
        textPathStartData: { segment: 0, position: 0 },
        getStyledTextSegments,
      }),
    );
    const asked = getStyledTextSegments.mock.calls[0]![0];
    for (const notDrawn of [
      'textDecoration',
      'lineHeight',
      'listOptions',
      'indentation',
      'textWrapStyle',
    ]) {
      expect(asked).not.toContain(notDrawn);
    }
    expect(out.segments?.map(seg => [seg.characters, seg.textDecoration])).toEqual([
      ['Ro', 'NONE'],
      ['und', 'NONE'],
    ]);
  });

  const stroked = (over: Record<string, unknown>) =>
    serializeFlatSync(
      fake({
        type: 'VECTOR',
        strokes: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 0 } }],
        strokeWeight: 8,
        dashPattern: [10, 5],
        absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
        absoluteRenderBounds: { x: -4, y: -30, width: 18, height: 70 },
        complexStrokeProperties: { type: 'BASIC' },
        variableWidthStrokeProperties: { widthProfile: 'UNIFORM', variableWidthPoints: [] },
        ...over,
      }),
    );

  it('reads a brush, dynamic or width-profile stroke, its painted box, and drops the dashes it hides', () => {
    const out = stroked({
      complexStrokeProperties: { type: 'DYNAMIC', frequency: 5, wiggle: 10, smoothen: 0.5 },
      variableWidthStrokeProperties: {
        widthProfile: 'TAPER',
        variableWidthPoints: [
          { position: 0, width: 0.5 },
          { position: 1, width: 0.1875 },
        ],
      },
    });
    expect(out.complexStrokeProperties).toEqual({
      type: 'DYNAMIC',
      frequency: 5,
      wiggle: 10,
      smoothen: 0.5,
    });
    expect(out.variableWidthStrokeProperties?.widthProfile).toBe('TAPER');
    expect(out.renderBounds).toEqual({ x: -4, y: -30, width: 18, height: 70 });
    expect(out).not.toHaveProperty('dashPattern');
  });

  it('leaves a plain stroke exactly as it was', () => {
    const out = stroked({});
    expect(out).not.toHaveProperty('complexStrokeProperties');
    expect(out).not.toHaveProperty('variableWidthStrokeProperties');
    // Render bounds are only read for Draw nodes, so a plain stroke never gains the field.
    expect(out).not.toHaveProperty('renderBounds');
    expect(out.dashPattern).toEqual([10, 5]);
  });

  it('reads no Draw stroke where there is no stroke for it to shape', () => {
    const out = stroked({
      strokes: [],
      complexStrokeProperties: {
        type: 'BRUSH',
        brushType: 'STRETCH',
        brushName: 'HEIST',
        direction: 'FORWARD',
      },
    });
    expect(out).not.toHaveProperty('complexStrokeProperties');
    expect(out).not.toHaveProperty('renderBounds');
  });
});
