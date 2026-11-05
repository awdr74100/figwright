import { describe, expect, it, vi } from 'vitest';

import { createCreateComponentHandler } from '../../src/handlers/create-component.js';
import { createCreateEllipseHandler } from '../../src/handlers/create-ellipse.js';
import { createCreateFrameHandler } from '../../src/handlers/create-frame.js';
import { createCreateRectangleHandler } from '../../src/handlers/create-rectangle.js';
import { createCreateSectionHandler } from '../../src/handlers/create-section.js';
import { createCreateShapeHandler } from '../../src/handlers/create-shape.js';
import { createImportImageHandler } from '../../src/handlers/import-image.js';
import { createImportSvgHandler } from '../../src/handlers/import-svg.js';

/** A new node at the default size its kind starts with (measured: 100, a section 496). */
const makeNode = (type: string, side: number) => {
  const node = {
    id: '2:1',
    name: type,
    type,
    x: 0,
    y: 0,
    width: side,
    height: side,
    fills: [] as unknown[],
    children: [] as unknown[],
    resize(w: number, h: number) {
      [node.width, node.height] = [w, h];
    },
    resizeWithoutConstraints(w: number, h: number) {
      [node.width, node.height] = [w, h];
    },
    remove: vi.fn<() => void>(),
  };
  return node;
};

/** A figma whose every create_* call is counted, so "nothing was created" can be asserted. */
const ctxFor = (node: ReturnType<typeof makeNode>) => {
  const created = vi.fn<() => unknown>(() => node);
  const ctx = {
    createRectangle: created,
    createEllipse: created,
    createFrame: created,
    createComponent: created,
    createSection: created,
    createPolygon: created,
    createLine: created,
    createStar: created,
    createNodeFromSvg: created,
    createImage: () => ({ hash: 'h', getSizeAsync: async () => ({ width: 640, height: 480 }) }),
    base64Decode: () => new Uint8Array(),
    currentPage: { appendChild: vi.fn<(n: unknown) => void>() },
    root: { documentColorProfile: 'SRGB' },
    getNodeByIdAsync: async () => null,
  } as unknown as typeof figma;
  return { ctx, created };
};

const CREATORS = [
  ['create_rectangle', createCreateRectangleHandler, 'RECTANGLE', 100, {}],
  ['create_ellipse', createCreateEllipseHandler, 'ELLIPSE', 100, {}],
  ['create_frame', createCreateFrameHandler, 'FRAME', 100, {}],
  ['create_component', createCreateComponentHandler, 'COMPONENT', 100, {}],
  ['create_section', createCreateSectionHandler, 'SECTION', 496, {}],
] as const;

describe('create_* width / height', () => {
  it.each(CREATORS)(
    '%s takes a width alone, keeping the default height',
    async (_, make, type, side) => {
      const node = makeNode(type, side);
      await make(ctxFor(node).ctx)({ width: 300 });
      expect(node).toMatchObject({ width: 300, height: side });
    },
  );

  it.each(CREATORS)(
    '%s takes a height alone, keeping the default width',
    async (_, make, type, side) => {
      const node = makeNode(type, side);
      await make(ctxFor(node).ctx)({ height: 160 });
      expect(node).toMatchObject({ width: side, height: 160 });
    },
  );

  it.each(CREATORS)(
    '%s takes both, and leaves the default without either',
    async (_, make, type, side) => {
      const both = makeNode(type, side);
      await make(ctxFor(both).ctx)({ width: 30, height: 40 });
      expect(both).toMatchObject({ width: 30, height: 40 });

      const neither = makeNode(type, side);
      await make(ctxFor(neither).ctx)({});
      expect(neither).toMatchObject({ width: side, height: side });
    },
  );

  // A 0 was stored as 0.0001 and answered ok; a negative threw from resize() after the node was
  // already on the page, leaving it there at its default size (both measured).
  const BAD = [0, -5, 0.005, Number.NaN, Number.POSITIVE_INFINITY, '120'];
  const ALL = [
    ...CREATORS.map(([tool, make, type, side]) => [tool, make, type, side, {}] as const),
    ['create_shape', createCreateShapeHandler, 'POLYGON', 100, { shape: 'POLYGON' }] as const,
    ['import_image', createImportImageHandler, 'RECTANGLE', 100, { data: 'AA==' }] as const,
    ['import_svg', createImportSvgHandler, 'FRAME', 24, { svg: '<svg/>' }] as const,
  ];
  it.each(
    ALL.flatMap(([tool, make, type, side, base]) =>
      BAD.flatMap(value =>
        (['width', 'height'] as const).map(
          field => [tool, field, value, make, type, side, base] as const,
        ),
      ),
    ),
  )(
    '%s refuses %s %s before it creates anything',
    async (tool, field, value, make, type, side, base) => {
      const node = makeNode(type, side);
      const { ctx, created } = ctxFor(node);
      await expect(make(ctx)({ ...base, [field]: value })).rejects.toThrow(
        `${tool}: ${field} must be a number of at least 0.01`,
      );
      expect(created).not.toHaveBeenCalled();
    },
  );
});

describe('create_frame with auto layout and one side', () => {
  /** A frame whose auto layout hugs the primary axis when turned on, as Figma's does. */
  const autoFrame = () => {
    const node = Object.assign(makeNode('FRAME', 100), {
      layoutMode: 'NONE',
      layoutWrap: 'NO_WRAP',
      layoutSizingHorizontal: 'FIXED',
      layoutSizingVertical: 'FIXED',
      layoutAlign: 'INHERIT',
      layoutGrow: 0,
      layoutPositioning: 'AUTO',
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: 'MIN',
      itemSpacing: 0,
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      clipsContent: true,
    });
    return node;
  };

  it('fixes the width it was given and leaves the height to hug', async () => {
    const node = autoFrame();
    const { ctx } = ctxFor(node);
    Object.assign(ctx, { getNodeByIdAsync: async () => node, mixed: Symbol('mixed') });
    let mode = 'NONE';
    Object.defineProperty(node, 'layoutMode', {
      get: () => mode,
      set: (value: string) => {
        mode = value;
        if (value === 'VERTICAL') node.layoutSizingVertical = 'HUG';
      },
    });
    await createCreateFrameHandler(ctx)({ width: 300, autoLayout: { layoutMode: 'VERTICAL' } });
    expect(node).toMatchObject({
      width: 300,
      layoutSizingHorizontal: 'FIXED',
      layoutSizingVertical: 'HUG',
    });
  });
});
