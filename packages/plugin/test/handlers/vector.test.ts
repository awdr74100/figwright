import type { GetVectorResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  createCreateVectorHandler,
  createGetVectorHandler,
  createOutlineStrokeHandler,
  createSetVectorHandler,
  placeOutline,
} from '../../src/handlers/vector.js';

type Affine = [[number, number, number], [number, number, number]];
const at = (x: number, y: number): Affine => [
  [1, 0, x],
  [0, 1, y],
];
const ctxWith = (nodes: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({
    getNodeByIdAsync: async (id: string) => nodes[id] ?? null,
    variables: {},
    ...extra,
  }) as unknown as typeof figma;

describe('get_vector', () => {
  it('reads paths and the network, Figma’s no-op defaults left out', async () => {
    const node = {
      id: '1:1',
      type: 'VECTOR',
      width: 80,
      height: 60,
      handleMirroring: 'NONE',
      vectorPaths: [{ windingRule: 'NONE', data: 'M 0 15 L 80 15', extra: 1 }],
      vectorNetwork: {
        vertices: [
          { x: 0, y: 15, strokeCap: 'ROUND', strokeJoin: 'MITER', cornerRadius: 0 },
          { x: 80.000001, y: 15, strokeCap: 'NONE', cornerRadius: 12, handleMirroring: 'NONE' },
        ],
        segments: [
          { start: 0, end: 1, tangentStart: { x: 20, y: -20 }, tangentEnd: { x: 0, y: 0 } },
        ],
        regions: [],
      },
    };
    const result = (await createGetVectorHandler(ctxWith({ '1:1': node }))({
      nodeId: '1:1',
    })) as GetVectorResult;
    expect(result).toEqual({
      nodeId: '1:1',
      type: 'VECTOR',
      width: 80,
      height: 60,
      vectorPaths: [{ windingRule: 'NONE', data: 'M 0 15 L 80 15' }],
      vectorNetwork: {
        vertices: [
          { x: 0, y: 15, strokeCap: 'ROUND' },
          { x: 80, y: 15, cornerRadius: 12 },
        ],
        segments: [{ start: 0, end: 1, tangentStart: { x: 20, y: -20 } }],
      },
      handleMirroring: 'NONE',
    });
  });

  it('reports mixed handle mirroring by name, not as Figma’s symbol', async () => {
    const node = {
      id: '1:1',
      type: 'TEXT_PATH',
      width: 1,
      height: 1,
      handleMirroring: Symbol('mixed'),
      vectorPaths: [],
      vectorNetwork: { vertices: [], segments: [] },
    };
    const result = (await createGetVectorHandler(ctxWith({ '1:1': node }))({
      nodeId: '1:1',
    })) as GetVectorResult;
    expect(result.handleMirroring).toBe('mixed');
  });

  it('points a shape at flatten_nodes', async () => {
    await expect(
      createGetVectorHandler(ctxWith({ r: { id: 'r', type: 'RECTANGLE' } }))({ nodeId: 'r' }),
    ).rejects.toThrow('is a RECTANGLE — only a VECTOR or text on a path has a path to read');
  });
});

const fakeVector = (log: string[]) => {
  const v: Record<string, unknown> = {
    id: '9:9',
    name: 'Vector',
    type: 'VECTOR',
    remove: vi.fn<() => void>(() => log.push('remove')),
    setVectorNetworkAsync: vi.fn<(n: unknown) => Promise<void>>(async n => {
      log.push('network');
      v.network = n;
    }),
  };
  let x = 0;
  Object.defineProperty(v, 'x', {
    get: () => x,
    set: (value: number) => {
      log.push(`x=${value}`);
      x = value;
    },
  });
  Object.defineProperty(v, 'vectorPaths', {
    set: (paths: { data: string }[]) => {
      // Figma's own parser: absolute M / L / C / Q / Z only.
      if (paths.some(p => /[^MLCQZ\d .-]/.test(p.data))) {
        throw new Error('in set_vectorPaths: Failed to convert path');
      }
      log.push(`paths=${paths.map(p => p.data).join('|')}`);
    },
  });
  return v;
};

describe('create_vector', () => {
  const setup = () => {
    const log: string[] = [];
    const vector = fakeVector(log);
    const page = { appendChild: vi.fn<(n: unknown) => void>(() => log.push('append')) };
    const ctx = ctxWith({}, { createVector: () => vector, currentPage: page });
    return { log, vector, ctx };
  };

  it('places the drawing’s origin first, then draws any SVG syntax in Figma’s dialect', async () => {
    const t = setup();
    await createCreateVectorHandler(t.ctx)({
      x: 40,
      y: 8,
      vectorPaths: [{ windingRule: 'NONE', data: 'M2 2h20a2 2 0 0 1 2 2' }],
    });
    expect(t.log).toEqual([
      'x=40',
      expect.stringMatching(/^paths=M 2 2 L 22 2 C 23\.104569 2 24 2\.895431 24 4$/),
      'append',
    ]);
  });

  it('names a path Figma could not read, and leaves nothing behind', async () => {
    const t = setup();
    await expect(
      createCreateVectorHandler(t.ctx)({ vectorPaths: [{ windingRule: 'NONE', data: 'M 0 0 X' }] }),
    ).rejects.toThrow(/vectorPaths\[0\]\.data is not valid SVG path data: expected a number/);
    // Refused before the vector exists.
    expect(t.log).toEqual([]);
  });

  it('removes a vector Figma refused to draw', async () => {
    const t = setup();
    t.vector.setVectorNetworkAsync = vi.fn<() => Promise<void>>(async () => {
      throw new Error('in setVectorNetworkAsync: bad network');
    });
    await expect(
      createCreateVectorHandler(t.ctx)({
        vectorNetwork: { vertices: [{ x: 0, y: 0 }], segments: [] },
      }),
    ).rejects.toThrow('bad network');
    expect(t.vector.remove).toHaveBeenCalled();
  });

  it.each([
    [{}, 'give exactly one of vectorPaths or vectorNetwork'],
    [
      { vectorPaths: [{ data: 'M 0 0' }], vectorNetwork: { vertices: [], segments: [] } },
      'exactly one',
    ],
    [
      { vectorNetwork: { vertices: [{ x: 0, y: 0 }], segments: [{ start: 0, end: 1 }] } },
      'segments[0].end must name one of the 1 vertices (0–0)',
    ],
    [
      {
        vectorNetwork: {
          vertices: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
          segments: [{ start: 0, end: 1 }],
          regions: [{ windingRule: 'NONZERO', loops: [[0, 1]] }],
        },
      },
      'regions[0].loops must list segment indices (0–0)',
    ],
  ])('refuses %j before creating anything', async (params, message) => {
    const t = setup();
    await expect(createCreateVectorHandler(t.ctx)(params)).rejects.toThrow(message);
    expect(t.log).toEqual([]);
  });
});

describe('set_vector', () => {
  it('redraws a VECTOR, normalising its path', async () => {
    const log: string[] = [];
    const vector = fakeVector(log);
    await createSetVectorHandler(ctxWith({ '9:9': vector }))({
      nodeId: '9:9',
      vectorPaths: [{ windingRule: 'NONE', data: 'm0 0 10 0v5' }],
    });
    expect(log).toEqual(['paths=M 0 0 L 10 0 L 10 5']);
  });

  it('keeps the round ends and joins a line had when its paths are redrawn, not a network', async () => {
    const make = () => {
      const node: Record<string, unknown> = {
        id: 'v',
        type: 'VECTOR',
        strokeCap: 'ROUND',
        strokeJoin: 'ROUND',
        setVectorNetworkAsync: async () => {
          node.strokeCap = 'NONE';
          node.strokeJoin = 'MITER';
        },
      };
      // New vertices come back with Figma's defaults.
      Object.defineProperty(node, 'vectorPaths', {
        set: () => {
          node.strokeCap = 'NONE';
          node.strokeJoin = 'MITER';
        },
      });
      return node;
    };
    const paths = make();
    await createSetVectorHandler(ctxWith({ v: paths }))({
      nodeId: 'v',
      vectorPaths: [{ windingRule: 'NONE', data: 'M 0 0 L 9 9' }],
    });
    expect(paths).toMatchObject({ strokeCap: 'ROUND', strokeJoin: 'ROUND' });
    const network = make();
    await createSetVectorHandler(ctxWith({ v: network }))({
      nodeId: 'v',
      vectorNetwork: { vertices: [{ x: 0, y: 0 }], segments: [] },
    });
    expect(network).toMatchObject({ strokeCap: 'NONE', strokeJoin: 'MITER' });
  });

  it('refuses what has no path of its own to redraw', async () => {
    const ctx = ctxWith({ t: { id: 't', type: 'TEXT_PATH' }, e: { id: 'e', type: 'ELLIPSE' } });
    const paths = [{ windingRule: 'NONE', data: 'M 0 0 L 1 1' }];
    await expect(createSetVectorHandler(ctx)({ nodeId: 't', vectorPaths: paths })).rejects.toThrow(
      'a text path keeps its path',
    );
    await expect(createSetVectorHandler(ctx)({ nodeId: 'e', vectorPaths: paths })).rejects.toThrow(
      'flatten_nodes turns a shape into one',
    );
  });
});

/** A parent whose children list and insertChild behave like Figma's. */
const container = (id: string, type: string, absolute: Affine, extra = {}) => {
  const node: Record<string, unknown> & { children: Record<string, unknown>[] } = {
    id,
    type,
    absoluteTransform: absolute,
    relativeTransform: absolute,
    children: [],
    parent: null,
    insertChild(index: number, child: Record<string, unknown>) {
      const old = child.parent as { children: unknown[] } | null;
      if (old) old.children.splice(old.children.indexOf(child), 1);
      node.children.splice(index, 0, child);
      child.parent = node;
    },
    ...extra,
  };
  return node;
};
const add = (parent: ReturnType<typeof container>, child: Record<string, unknown>) => {
  parent.children.push(child);
  child.parent = parent;
  return child;
};

/** A layer whose absolute transform follows its parent, as Figma's does. */
const leaf = (id: string, rel: Affine, extra: Record<string, unknown> = {}) => {
  const node: Record<string, unknown> = { id, relativeTransform: rel, parent: null, ...extra };
  Object.defineProperty(node, 'absoluteTransform', {
    get: () => {
      const parent = node.parent as { type: string; parent: unknown; absoluteTransform: Affine };
      // A child of a frame lives in the frame's space; a group's children in the group's parent's.
      const space =
        parent.type === 'GROUP'
          ? (parent.parent as { absoluteTransform: Affine }).absoluteTransform
          : parent.absoluteTransform;
      const r = node.relativeTransform as Affine;
      return [
        [r[0][0], r[0][1], r[0][2] + space[0][2]],
        [r[1][0], r[1][1], r[1][2] + space[1][2]],
      ];
    },
  });
  return node;
};

/** A leaf that also reports where it paints: `paint` offset and size from its absolute origin. */
const painted = (id: string, rel: Affine, paint: [number, number, number, number], extra = {}) => {
  const node = leaf(id, rel, extra);
  Object.defineProperty(node, 'absoluteRenderBounds', {
    get: () => {
      const t = node.absoluteTransform as Affine;
      return { x: t[0][2] + paint[0], y: t[1][2] + paint[1], width: paint[2], height: paint[3] };
    },
  });
  return node;
};

describe('placeOutline', () => {
  it('puts the outline just above its source, at the spot the stroke was drawn', () => {
    const page = container('0:1', 'PAGE', at(0, 0));
    const frame = add(page, container('F', 'FRAME', at(100, 50))) as ReturnType<typeof container>;
    const source = add(frame, leaf('S', at(10, 10)));
    add(frame, { id: 'above' });
    // Figma's outline: on the page, its transform measured from the frame's top-left.
    const outline = add(page, leaf('O', at(6, 7)));
    placeOutline(source as unknown as SceneNode, outline as unknown as SceneNode);
    expect(frame.children.map(c => c.id)).toEqual(['S', 'O', 'above']);
    expect(outline.relativeTransform).toEqual(at(6, 7));
    expect(outline.absoluteTransform).toEqual(at(106, 57));
  });

  it('measures from a group’s own box, though its children are placed in the parent’s space', () => {
    const page = container('0:1', 'PAGE', at(0, 0));
    const frame = add(page, container('F', 'FRAME', at(100, 0))) as ReturnType<typeof container>;
    const group = add(frame, container('G', 'GROUP', at(130, 20))) as ReturnType<typeof container>;
    const source = add(group, leaf('S', at(40, 30)));
    const outline = add(page, leaf('O', at(5, 6)));
    placeOutline(source as unknown as SceneNode, outline as unknown as SceneNode);
    expect(group.children.map(c => c.id)).toEqual(['S', 'O']);
    // From the group's box at (130, 20): absolutely (135, 26), so (35, 26) in the frame's space.
    expect(outline.absoluteTransform).toEqual(at(135, 26));
    expect(outline.relativeTransform).toEqual(at(35, 26));
  });

  it.each(['INSTANCE', 'BOOLEAN_OPERATION', 'TRANSFORM_GROUP'])(
    'goes above a %s holding the source, which cannot take it',
    type => {
      const page = container('0:1', 'PAGE', at(0, 0));
      const frame = add(page, container('F', 'FRAME', at(0, 0))) as ReturnType<typeof container>;
      const holder = add(frame, container('H', type, at(0, 0))) as ReturnType<typeof container>;
      const inner = add(holder, container('I', 'FRAME', at(0, 0))) as ReturnType<typeof container>;
      const source = add(inner, leaf('S', at(0, 0)));
      const outline = add(page, leaf('O', at(1, 2)));
      placeOutline(source as unknown as SceneNode, outline as unknown as SceneNode);
      expect(frame.children.map(c => c.id)).toEqual(['H', 'O']);
      expect(inner.children.map(c => c.id)).toEqual(['S']);
    },
  );

  it('is absolutely positioned in an auto-layout parent, so the flow does not move', () => {
    const page = container('0:1', 'PAGE', at(0, 0));
    const row = add(page, container('A', 'FRAME', at(0, 0), { layoutMode: 'HORIZONTAL' }));
    const source = add(row as ReturnType<typeof container>, leaf('S', at(0, 0)));
    const outline = add(page, leaf('O', at(0, -2), { layoutPositioning: 'AUTO' }));
    placeOutline(source as unknown as SceneNode, outline as unknown as SceneNode);
    expect(outline.layoutPositioning).toBe('ABSOLUTE');
  });

  it('lines the outline’s paint up with the stroke’s, whatever the transform rule left', () => {
    const page = container('0:1', 'PAGE', at(0, 0));
    const frame = add(page, container('F', 'FRAME', at(0, 0))) as ReturnType<typeof container>;
    const source = add(frame, painted('S', at(100, 50), [-20, -5, 60, 30]));
    // Figma's outline, its transform somewhere the rule above does not account for.
    const outline = add(page, painted('O', at(7, 3), [0, 0, 60, 30]));
    placeOutline(source as unknown as SceneNode, outline as unknown as SceneNode);
    expect((outline.absoluteRenderBounds as Rect).x).toBeCloseTo(80, 6);
    expect((outline.absoluteRenderBounds as Rect).y).toBeCloseTo(45, 6);
  });

  it('leaves an outline whose paint is clipped to another size where the rule put it', () => {
    const page = container('0:1', 'PAGE', at(0, 0));
    const frame = add(page, container('F', 'FRAME', at(0, 0))) as ReturnType<typeof container>;
    const source = add(frame, painted('S', at(100, 50), [-20, -5, 30, 30]));
    const outline = add(page, painted('O', at(7, 3), [0, 0, 60, 30]));
    placeOutline(source as unknown as SceneNode, outline as unknown as SceneNode);
    expect(outline.relativeTransform).toEqual(at(7, 3));
  });

  it('goes beside a group an auto-layout frame lays out, so the group does not grow and move', () => {
    const page = container('0:1', 'PAGE', at(0, 0));
    const column = add(
      page,
      container('C', 'FRAME', at(0, 0), { layoutMode: 'VERTICAL' }),
    ) as ReturnType<typeof container>;
    const outer = add(column, container('G1', 'GROUP', at(0, 0))) as ReturnType<typeof container>;
    const inner = add(outer, container('G2', 'GROUP', at(0, 0))) as ReturnType<typeof container>;
    const source = add(inner, leaf('S', at(10, 10)));
    const outline = add(page, leaf('O', at(0, 0), { layoutPositioning: 'AUTO' }));
    placeOutline(source as unknown as SceneNode, outline as unknown as SceneNode);
    expect(column.children.map(c => c.id)).toEqual(['G1', 'O']);
    expect(inner.children.map(c => c.id)).toEqual(['S']);
    expect(outline.layoutPositioning).toBe('ABSOLUTE');
  });

  it('drops the aspect ratio it inherits from the stroke before it joins a layout', () => {
    const page = container('0:1', 'PAGE', at(0, 0));
    const row = add(page, container('A', 'FRAME', at(0, 0), { layoutMode: 'HORIZONTAL' }));
    const source = add(row as ReturnType<typeof container>, leaf('S', at(0, 0)));
    const log: string[] = [];
    const outline = add(page, leaf('O', at(0, 0), { targetAspectRatio: { x: 16, y: 1 } }));
    outline.unlockAspectRatio = () => {
      log.push(`unlock, in ${String((outline.parent as { id: string }).id)}`);
      outline.targetAspectRatio = null;
    };
    placeOutline(source as unknown as SceneNode, outline as unknown as SceneNode);
    expect(log).toEqual(['unlock, in 0:1']);
    expect(outline.targetAspectRatio).toBeNull();
  });
});

describe('outline_stroke', () => {
  const stroked = (strokes: unknown[], strokeWeight: number) => {
    const outlineStroke = vi.fn<() => unknown>(() => null);
    const node = { id: 'S', type: 'TEXT_PATH', strokes, strokeWeight, outlineStroke };
    return { node, outlineStroke, ctx: ctxWith({ S: node }) };
  };

  it.each([
    ['no stroke', [], 1],
    ['only hidden strokes', [{ type: 'SOLID', visible: false }], 1],
    ['a zero weight', [{ type: 'SOLID' }], 0],
  ])('refuses %s without asking Figma, which throws on text on a path', async (_l, strokes, w) => {
    const t = stroked(strokes, w);
    await expect(createOutlineStrokeHandler(t.ctx)({ nodeId: 'S' })).rejects.toThrow(
      'has no stroke to outline — give it one with set_strokes',
    );
    expect(t.outlineStroke).not.toHaveBeenCalled();
  });

  it('refuses when Figma finds nothing to outline', async () => {
    const t = stroked([{ type: 'SOLID' }], 2);
    await expect(createOutlineStrokeHandler(t.ctx)({ nodeId: 'S' })).rejects.toThrow(
      'has no stroke to outline',
    );
    expect(t.outlineStroke).toHaveBeenCalled();
  });

  it('removes the outline when it cannot be placed', async () => {
    const remove = vi.fn<() => void>();
    const outline = {
      id: 'O',
      remove,
      get relativeTransform(): never {
        throw new Error('boom');
      },
    };
    const node = {
      id: 'S',
      strokes: [{ type: 'SOLID' }],
      strokeWeight: 1,
      parent: { type: 'FRAME', absoluteTransform: at(0, 0) },
      outlineStroke: () => outline,
    };
    await expect(createOutlineStrokeHandler(ctxWith({ S: node }))({ nodeId: 'S' })).rejects.toThrow(
      'boom',
    );
    expect(remove).toHaveBeenCalled();
  });
});
