import { describe, expect, it } from 'vitest';

import {
  captureGeometry,
  captureLayoutScope,
  captureProps,
  restoreGeometry,
  restoreLayoutDrift,
  restoreOrder,
  restoreProps,
  same,
  writeIfDifferent,
} from '../../src/handlers/batch-snapshot.js';

type Node = Record<string, unknown> & { id: string };

/** A figma stand-in whose variables resolve to `{ id }` and whose nodes come from `store`. */
const ctxFor = (store: Map<string, Node>): typeof figma =>
  ({
    getNodeByIdAsync: async (id: string) => store.get(id) ?? null,
    variables: { getVariableByIdAsync: async (id: string) => ({ id }) },
  }) as unknown as typeof figma;

describe('same / writeIfDifferent', () => {
  it('never treats figma.mixed as equal to a value, and never writes it', () => {
    const mixed = Symbol('mixed');
    expect(same(mixed, 1)).toBe(false);
    expect(same({ a: [1] }, { a: [1] })).toBe(true);
    const node = { fills: 'x', opacity: 1 };
    writeIfDifferent(node, 'fills', mixed);
    writeIfDifferent(node, 'missing', 2);
    expect(node).toEqual({ fills: 'x', opacity: 1 });
  });

  it('skips a write whose value is already there', () => {
    const writes: unknown[] = [];
    const node = {
      get opacity() {
        return 0.5;
      },
      set opacity(v: unknown) {
        writes.push(v);
      },
    };
    writeIfDifferent(node, 'opacity', 0.5);
    writeIfDifferent(node, 'opacity', 0.2);
    expect(writes).toEqual([0.2]);
  });
});

describe('restoreProps', () => {
  /**
   * A node that behaves like Figma's where restoreProps depends on it (measured): writing `fills`
   * detaches the fill style even when the value is identical; a raw write to a bound field drops
   * the binding. Every mutation is logged in order.
   */
  const fakeNode = (): { node: Node; log: string[] } => {
    const log: string[] = [];
    let fills: unknown = ['red'];
    let fillStyleId = 'S:red';
    let opacity = 0.5;
    let bound: Record<string, { type: string; id: string }> = {
      opacity: { type: 'VARIABLE_ALIAS', id: 'V:half' },
    };
    const node: Node = {
      id: '1:1',
      get fills() {
        return fills;
      },
      set fills(v: unknown) {
        log.push('fills');
        fills = v;
        fillStyleId = '';
      },
      get fillStyleId() {
        return fillStyleId;
      },
      setFillStyleIdAsync: async (id: string) => {
        log.push(`style ${id}`);
        fillStyleId = id;
      },
      get opacity() {
        return opacity;
      },
      set opacity(v: number) {
        log.push('opacity');
        opacity = v;
        const { opacity: _dropped, ...rest } = bound;
        bound = rest;
      },
      get boundVariables() {
        return bound;
      },
      setBoundVariable: (field: string, v: { id: string } | null) => {
        log.push(`bind ${field}=${v === null ? 'null' : v.id}`);
        const { [field]: _old, ...rest } = bound;
        bound = v === null ? rest : { ...rest, [field]: { type: 'VARIABLE_ALIAS', id: v.id } };
      },
    };
    return { node, log };
  };

  it('puts the value back, then the style link the write detached, then the binding it dropped', async () => {
    const { node, log } = fakeNode();
    const ctx = ctxFor(new Map([[node.id, node]]));
    const snapshot = await captureProps(ctx, node as unknown as BaseNode, ['fills', 'opacity']);
    // The op: new fills (detaches the style), a raw opacity (drops the binding).
    node.fills = ['blue'];
    node.opacity = 0.2;
    log.length = 0;

    await restoreProps(node as unknown as BaseNode, snapshot);

    expect(node.fills).toEqual(['red']);
    expect(node.fillStyleId).toBe('S:red');
    expect(node.boundVariables).toEqual({ opacity: { type: 'VARIABLE_ALIAS', id: 'V:half' } });
    // Raw value first (it detaches), then the style; the binding last so it wins over the raw value.
    expect(log).toEqual(['fills', 'opacity', 'style S:red', 'bind opacity=V:half']);
  });

  it('re-attaches the style even when the op wrote back an identical value', async () => {
    const { node } = fakeNode();
    const ctx = ctxFor(new Map([[node.id, node]]));
    const snapshot = await captureProps(ctx, node as unknown as BaseNode, ['fills']);
    node.fills = ['red']; // same paints, style detached anyway (measured)
    await restoreProps(node as unknown as BaseNode, snapshot);
    expect(node.fillStyleId).toBe('S:red');
  });

  it('unbinds what the op bound before the raw value goes back', async () => {
    const { node, log } = fakeNode();
    const ctx = ctxFor(new Map([[node.id, node]]));
    (node.setBoundVariable as (f: string, v: null) => void)('opacity', null);
    const snapshot = await captureProps(ctx, node as unknown as BaseNode, ['opacity']);
    (node.setBoundVariable as (f: string, v: { id: string }) => void)('opacity', { id: 'V:new' });
    log.length = 0;

    await restoreProps(node as unknown as BaseNode, snapshot);

    expect(node.boundVariables).toEqual({});
    expect(log[0]).toBe('bind opacity=null');
  });
});

describe('restoreOrder', () => {
  /**
   * A container whose insertChild counts the index before removing the node, as Figma's does
   * (measured).
   */
  const container = (ids: string[]): Node & { children: Node[] } => {
    const parent = {
      id: 'P',
      children: [] as Node[],
      insertChild(index: number, child: Node) {
        const at = parent.children.indexOf(child);
        parent.children.splice(index, 0, child);
        if (at !== -1) parent.children.splice(at < index ? at : at + 1, 1);
      },
    };
    parent.children = ids.map(id => ({ id }));
    return parent as unknown as Node & { children: Node[] };
  };

  it('rebuilds a shuffled child order exactly', async () => {
    const parent = container(['a', 'b', 'c', 'd']);
    const store = new Map<string, Node>([
      ['P', parent],
      ...parent.children.map(c => [c.id, c] as [string, Node]),
    ]);
    const insert = parent.insertChild as unknown as (i: number, c: Node) => void;
    insert.call(parent, 3, parent.children[0]!); // b c a d
    insert.call(parent, 0, parent.children[3]!); // d b c a
    expect(parent.children.map(c => c.id).join('')).not.toBe('abcd');

    await restoreOrder(ctxFor(store), 'P', ['a', 'b', 'c', 'd']);

    expect(parent.children.map(c => c.id).join('')).toBe('abcd');
  });

  it('leaves a child that was not in the snapshot after the ones that were', async () => {
    const parent = container(['x', 'a', 'b']);
    const store = new Map<string, Node>([
      ['P', parent],
      ...parent.children.map(c => [c.id, c] as [string, Node]),
    ]);
    await restoreOrder(ctxFor(store), 'P', ['a', 'b']);
    expect(parent.children.map(c => c.id)).toEqual(['a', 'b', 'x']);
  });
});

describe('restoreGeometry', () => {
  it('writes bounds, positioning, the sizing primitives, then the size and transform', () => {
    const log: string[] = [];
    const state: Record<string, unknown> = {
      maxWidth: null,
      layoutPositioning: 'ABSOLUTE',
      layoutGrow: 0,
      layoutAlign: 'INHERIT',
      constraints: { horizontal: 'MIN', vertical: 'MIN' },
    };
    const node = new Proxy(
      {
        id: '1:1',
        type: 'RECTANGLE',
        parent: { layoutMode: 'HORIZONTAL' },
        width: 100,
        height: 50,
        relativeTransform: [
          [1, 0, 10],
          [0, 1, 20],
        ],
        resizeWithoutConstraints(w: number, h: number) {
          log.push('size');
          (node as unknown as Record<string, unknown>).width = w;
          (node as unknown as Record<string, unknown>).height = h;
        },
      } as Record<string, unknown>,
      {
        has: (t, k) => k in t || k in state,
        get: (t, k: string) => (k in state ? state[k] : t[k]),
        set: (t, k: string, v) => {
          if (k === 'relativeTransform') log.push('transform');
          if (k in state) {
            log.push(k);
            state[k] = v;
          } else t[k] = v;
          return true;
        },
      },
    ) as unknown as SceneNode & Record<string, unknown>;
    const snapshot = captureGeometry(node);

    // The op: clamp, pull into the flow, stretch, move.
    state.maxWidth = 60;
    state.layoutPositioning = 'AUTO';
    state.layoutGrow = 1;
    (node as unknown as Record<string, unknown>).width = 60;
    node.relativeTransform = [
      [1, 0, 0],
      [0, 1, 0],
    ];
    log.length = 0;

    restoreGeometry(node, snapshot);

    // Sizing goes back before the size: a size written under STRETCH is overridden by the layout.
    expect(log).toEqual(['maxWidth', 'layoutPositioning', 'layoutGrow', 'size', 'transform']);
    expect(node.relativeTransform).toEqual(snapshot.transform);
  });
});

describe('layout scope', () => {
  it('records the constrained boxes of the region, not in-flow children or instance sublayers', async () => {
    const t = [
      [1, 0, 0],
      [0, 1, 0],
    ];
    const al: Node = {
      id: 'AL',
      type: 'FRAME',
      layoutMode: 'HORIZONTAL',
      width: 10,
      height: 10,
      relativeTransform: t,
    };
    const inflow: Node = {
      id: 'IN',
      type: 'RECTANGLE',
      parent: al,
      layoutPositioning: 'AUTO',
      width: 1,
      height: 1,
      relativeTransform: t,
    };
    const absolute: Node = {
      id: 'ABS',
      type: 'RECTANGLE',
      parent: al,
      layoutPositioning: 'ABSOLUTE',
      width: 5,
      height: 5,
      relativeTransform: t,
    };
    const sublayer: Node = {
      id: 'I1;2',
      type: 'RECTANGLE',
      parent: al,
      layoutPositioning: 'ABSOLUTE',
      width: 5,
      height: 5,
      relativeTransform: t,
    };
    al.parent = { id: 'PAGE', type: 'PAGE' };
    al.findAll = () => [inflow, absolute, sublayer];
    const store = new Map<string, Node>([al, inflow, absolute, sublayer].map(n => [n.id, n]));

    const scope = await captureLayoutScope(ctxFor(store), ['IN']);

    expect(scope.map(s => s.id)).toEqual(['AL', 'ABS']);
  });

  it('puts a drifted constrained box back and leaves an undrifted one alone', async () => {
    const writes: string[] = [];
    const box = (id: string): Node => ({
      id,
      type: 'RECTANGLE',
      parent: { layoutMode: 'NONE' },
      width: 100,
      height: 20,
      relativeTransform: [
        [1, 0, 50],
        [0, 1, 0],
      ],
      resizeWithoutConstraints(this: Node, w: number, h: number) {
        writes.push(`${id} size`);
        this.width = w;
        this.height = h;
      },
    });
    const drifted = box('D');
    const steady = box('S');
    const store = new Map<string, Node>([drifted, steady].map(n => [n.id, n]));
    const scope = [
      captureGeometry(drifted as unknown as SceneNode),
      captureGeometry(steady as unknown as SceneNode),
    ];
    drifted.width = 0.01; // squeezed past its margins by a constraint

    await restoreLayoutDrift(ctxFor(store), scope);

    expect(drifted.width).toBe(100);
    expect(writes).toEqual(['D size']);
  });
});
