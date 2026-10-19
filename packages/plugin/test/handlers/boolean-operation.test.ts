import type { CreateResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createBooleanOperationHandler } from '../../src/handlers/boolean-operation.js';
import { createFlattenNodesHandler } from '../../src/handlers/flatten-nodes.js';

const setup = () => {
  const parent = { id: '0:1', type: 'FRAME', appendChild: () => {}, children: [] as unknown[] };
  const other = { id: '0:2', type: 'FRAME', appendChild: () => {}, children: [] as unknown[] };
  const paint = (r: number) => [{ type: 'SOLID', color: { r, g: 0, b: 0 } }];
  const mk = (id: string, under = parent, r = 0) => {
    const n = {
      id,
      type: 'RECTANGLE',
      parent: under,
      fills: paint(r),
      effects: [] as unknown[],
      fillStyleId: '',
      effectStyleId: '',
    };
    under.children.push(n);
    return n;
  };
  const a = mk('1:1', parent, 0.1); // bottom
  const b = mk('1:2', parent, 0.2);
  const c = mk('1:3', parent, 0.3); // top
  const stray = mk('2:1', other);
  const nodes: Record<string, unknown> = { '1:1': a, '1:2': b, '1:3': c, '2:1': stray };

  const made = (id: string, type: string) => {
    const r: Record<string, unknown> = {
      id,
      name: type,
      type,
      fills: [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.85 } }], // Figma's default grey
      effects: [],
      setFillStyleIdAsync: async (styleId: string) => {
        r.fillStyleId = styleId;
      },
      setEffectStyleIdAsync: async (styleId: string) => {
        r.effectStyleId = styleId;
      },
    };
    return r;
  };
  const union = vi.fn<(...args: unknown[]) => unknown>(() => made('9:1', 'BOOLEAN_OPERATION'));
  const subtract = vi.fn<(...args: unknown[]) => unknown>(() => made('9:2', 'BOOLEAN_OPERATION'));
  const intersect = vi.fn<(...args: unknown[]) => unknown>(() => made('9:3', 'BOOLEAN_OPERATION'));
  const exclude = vi.fn<(...args: unknown[]) => unknown>(() => made('9:4', 'BOOLEAN_OPERATION'));
  const flatten = vi.fn<(...args: unknown[]) => unknown>(() => made('9:5', 'VECTOR'));
  const ctx = {
    getNodeByIdAsync: async (id: string) => nodes[id] ?? null,
    union,
    subtract,
    intersect,
    exclude,
    flatten,
  } as unknown as typeof figma;
  return { ctx, parent, a, b, c, stray, union, subtract, intersect, exclude, flatten };
};

describe('boolean_operation handler', () => {
  it('runs the matching Figma operation under the shared parent, at the topmost operand’s index', async () => {
    const t = setup();
    const result = (await createBooleanOperationHandler(t.ctx)({
      operation: 'SUBTRACT',
      nodeIds: ['1:1', '1:2'],
      name: 'ring',
    })) as CreateResult;
    expect(t.subtract).toHaveBeenCalledWith([t.a, t.b], t.parent, 1);
    expect(t.union).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, nodeId: '9:2', name: 'ring', type: 'BOOLEAN_OPERATION' });
  });

  it.each([
    ['UNION', 'union'],
    ['INTERSECT', 'intersect'],
    ['EXCLUDE', 'exclude'],
  ] as const)('maps %s to figma.%s', async (operation, method) => {
    const t = setup();
    await createBooleanOperationHandler(t.ctx)({ operation, nodeIds: ['1:1', '1:3'] });
    expect(t[method]).toHaveBeenCalledWith([t.a, t.c], t.parent, 2);
  });

  it('hands Figma the operands bottom to top, whatever order the ids came in', async () => {
    const t = setup();
    await createBooleanOperationHandler(t.ctx)({ operation: 'UNION', nodeIds: ['1:3', '1:1'] });
    expect(t.union).toHaveBeenCalledWith([t.a, t.c], t.parent, 2);
  });

  it.each(['UNION', 'INTERSECT', 'EXCLUDE'] as const)(
    '%s paints the result with the topmost operand’s fill and effects, as Figma’s command does',
    async operation => {
      const t = setup();
      const shadow = { type: 'DROP_SHADOW', visible: true };
      t.c.effects = [shadow];
      const result = await createBooleanOperationHandler(t.ctx)({
        operation,
        nodeIds: ['1:3', '1:1'],
      });
      const made = t[operation.toLowerCase() as 'union'].mock.results[0]!.value as Record<
        string,
        unknown
      >;
      expect(result).toMatchObject({ ok: true });
      expect(made.fills).toBe(t.c.fills);
      expect(made.effects).toEqual([shadow]);
    },
  );

  it('SUBTRACT paints the result like the lowest operand, the shape being cut', async () => {
    const t = setup();
    await createBooleanOperationHandler(t.ctx)({ operation: 'SUBTRACT', nodeIds: ['1:3', '1:1'] });
    const made = t.subtract.mock.results[0]!.value as Record<string, unknown>;
    expect(made.fills).toBe(t.a.fills);
  });

  it('re-applies a fill or effect style as the style, not as its values', async () => {
    const t = setup();
    t.c.fillStyleId = 'S:fill';
    t.c.effectStyleId = 'S:fx';
    await createBooleanOperationHandler(t.ctx)({ operation: 'UNION', nodeIds: ['1:1', '1:3'] });
    const made = t.union.mock.results[0]!.value as Record<string, unknown>;
    expect(made).toMatchObject({ fillStyleId: 'S:fill', effectStyleId: 'S:fx' });
    expect((made.fills as { color: { r: number } }[])[0]!.color.r).toBe(0.85); // values untouched
  });

  it('refuses nodes under different parents, naming the stray one', async () => {
    const t = setup();
    await expect(
      createBooleanOperationHandler(t.ctx)({ operation: 'UNION', nodeIds: ['1:1', '2:1'] }),
    ).rejects.toThrow(/2:1 is under a different one.*reparent_nodes/s);
    expect(t.union).not.toHaveBeenCalled();
  });

  it('rejects bad input and missing nodes', async () => {
    const t = setup();
    const handler = createBooleanOperationHandler(t.ctx);
    await expect(handler({ nodeIds: ['1:1', '1:2'] })).rejects.toThrow(/operation must be/);
    await expect(handler({ operation: 'MERGE', nodeIds: ['1:1', '1:2'] })).rejects.toThrow(
      /operation must be/,
    );
    await expect(handler({ operation: 'UNION', nodeIds: ['1:1'] })).rejects.toThrow(/at least 2/);
    await expect(handler({ operation: 'UNION', nodeIds: ['1:1', '1:1'] })).rejects.toThrow(
      /at least 2 distinct/,
    );
    await expect(handler({ operation: 'UNION', nodeIds: ['1:1', '9:9'] })).rejects.toThrow(
      /9:9 not found/,
    );
  });
});

describe('flatten_nodes handler', () => {
  it('flattens a single node or several into one vector in place', async () => {
    const t = setup();
    const result = (await createFlattenNodesHandler(t.ctx)({
      nodeIds: ['1:2'],
      name: 'icon',
    })) as CreateResult;
    expect(t.flatten).toHaveBeenCalledWith([t.b], t.parent, 1);
    expect(result).toEqual({ ok: true, nodeId: '9:5', name: 'icon', type: 'VECTOR' });
  });

  it('passes a repeated id once', async () => {
    const t = setup();
    await createFlattenNodesHandler(t.ctx)({ nodeIds: ['1:2', '1:2', '1:1'] });
    expect(t.flatten).toHaveBeenCalledWith([t.a, t.b], t.parent, 1);
  });

  it('shares the one-parent rule and rejects bad input', async () => {
    const t = setup();
    const handler = createFlattenNodesHandler(t.ctx);
    await expect(handler({ nodeIds: ['1:1', '2:1'] })).rejects.toThrow(/share one parent/);
    await expect(handler({ nodeIds: [] })).rejects.toThrow(/non-empty/);
    await expect(handler({})).rejects.toThrow(/non-empty/);
  });
});
