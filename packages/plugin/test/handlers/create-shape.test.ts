import type { CreateResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createCreateShapeHandler } from '../../src/handlers/create-shape.js';

interface FakeShape {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pointCount?: number;
  innerRadius?: number;
  strokes: unknown[];
  strokeWeight: number;
  removed: boolean;
  resize(w: number, h: number): void;
  remove(): void;
}

const shape = (type: string): FakeShape => {
  const s: FakeShape = {
    id: '9:1',
    name: type.toLowerCase(),
    type,
    x: 0,
    y: 0,
    width: 100,
    height: type === 'LINE' ? 0 : 100,
    strokes: [],
    strokeWeight: 1,
    removed: false,
    resize(w, h) {
      s.width = w;
      s.height = h;
    },
    remove() {
      s.removed = true;
    },
  };
  return s;
};

const setup = (nodes: Record<string, unknown> = {}) => {
  const created: FakeShape[] = [];
  const appended: unknown[] = [];
  const make = (type: string) => () => {
    const s = shape(type);
    created.push(s);
    return s;
  };
  const ctx = {
    createLine: make('LINE'),
    createPolygon: make('POLYGON'),
    createStar: make('STAR'),
    currentPage: { appendChild: (n: unknown) => appended.push(n) },
    getNodeByIdAsync: async (id: string) => nodes[id] ?? created.find(c => c.id === id) ?? null,
    root: { documentColorProfile: 'SRGB' },
  } as unknown as typeof figma;
  return { handler: createCreateShapeHandler(ctx), created, appended };
};

describe('create_shape handler', () => {
  it('creates a line of the requested length, at height 0', async () => {
    const { handler, created, appended } = setup();
    const result = (await handler({
      shape: 'LINE',
      width: 240,
      x: 10,
      y: 20,
      name: 'rule',
    })) as CreateResult;
    expect(created[0]).toMatchObject({ width: 240, height: 0, x: 10, y: 20, name: 'rule' });
    expect(appended).toHaveLength(1);
    expect(result).toEqual({ ok: true, nodeId: '9:1', name: 'rule', type: 'LINE' });
  });

  it('creates a polygon with its side count and a star with points and inner radius', async () => {
    const poly = setup();
    await poly.handler({ shape: 'POLYGON', pointCount: 6, width: 80, height: 80 });
    expect(poly.created[0]).toMatchObject({ pointCount: 6, width: 80, height: 80 });

    const star = setup();
    await star.handler({ shape: 'STAR', pointCount: 5, innerRadius: 0.5 });
    expect(star.created[0]).toMatchObject({ pointCount: 5, innerRadius: 0.5 });
  });

  it('keeps a shape regular when only one dimension is given', async () => {
    const { handler, created } = setup();
    await handler({ shape: 'STAR', width: 64 });
    expect(created[0]).toMatchObject({ width: 64, height: 64 });
  });

  it('appends into a parent when given, and removes the orphan if the parent is unusable', async () => {
    const appended: unknown[] = [];
    const parent = { appendChild: (n: unknown) => appended.push(n) };
    const ok = setup({ '1:1': parent });
    await ok.handler({ shape: 'POLYGON', parentId: '1:1' });
    expect(appended).toHaveLength(1);

    const bad = setup({ '1:2': { id: '1:2' } });
    await expect(bad.handler({ shape: 'POLYGON', parentId: '1:2' })).rejects.toThrow(
      /cannot contain children/,
    );
    expect(bad.created[0]!.removed).toBe(true);
  });

  it('refuses nonsensical combinations before creating anything', async () => {
    const { handler, created } = setup();
    await expect(handler({})).rejects.toThrow(/LINE, POLYGON or STAR/);
    await expect(handler({ shape: 'CIRCLE' })).rejects.toThrow(/LINE, POLYGON or STAR/);
    await expect(handler({ shape: 'LINE', height: 10 })).rejects.toThrow(/no height/);
    await expect(handler({ shape: 'LINE', pointCount: 5 })).rejects.toThrow(
      /do not apply to a LINE/,
    );
    await expect(handler({ shape: 'POLYGON', innerRadius: 0.5 })).rejects.toThrow(/STAR only/);
    await expect(handler({ shape: 'STAR', pointCount: 2 })).rejects.toThrow(/3 to 60/);
    await expect(handler({ shape: 'STAR', pointCount: 4.5 })).rejects.toThrow(/3 to 60/);
    // Figma draws 60 for anything larger, so a larger count is refused rather than misreported.
    await expect(handler({ shape: 'POLYGON', pointCount: 61 })).rejects.toThrow(/3 to 60/);
    await expect(handler({ shape: 'STAR', innerRadius: 2 })).rejects.toThrow(/at most 1/);
    // 0 is a star with no area: Figma draws nothing.
    await expect(handler({ shape: 'STAR', innerRadius: 0 })).rejects.toThrow(/above 0/);
    await expect(handler({ shape: 'STAR', width: 'wide' })).rejects.toThrow(
      /width must be a number/,
    );
    expect(created).toHaveLength(0);
  });

  it('strokes a line in the call that creates it', async () => {
    const { handler, created } = setup();
    await handler({
      shape: 'LINE',
      width: 120,
      strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 } }],
      strokeWeight: 3,
    });
    expect(created[0]).toMatchObject({ strokeWeight: 3, removed: false });
    expect(created[0]!.strokes).toHaveLength(1);
  });

  it('removes the new shape when a style step is refused', async () => {
    const { handler, created } = setup();
    await expect(handler({ shape: 'STAR', strokeWeight: 2 })).rejects.toThrow(
      /need strokes.*removed/s,
    );
    expect(created[0]!.removed).toBe(true);
  });
});
