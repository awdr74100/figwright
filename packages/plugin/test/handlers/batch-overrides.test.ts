import { describe, expect, it, vi } from 'vitest';

import { captureOverrideGuard, restoreOverrideGuard } from '../../src/handlers/batch-overrides.js';

type Override = { id: string; overriddenFields: string[] };
type Node = Record<string, unknown> & { id: string };

/**
 * An instance that behaves like Figma's where the guard depends on it (measured): writing a
 * sublayer field — even its current value — marks it overridden; removeOverrides() puts every
 * sublayer back to its main's values, clears the list, and reverts nested swaps. A `hidden` field
 * (a 3D transform, a dynamic stroke, …) is the exception Figma makes: writing it marks nothing, and
 * removeOverrides() resets it all the same.
 */
const makeInstance = () => {
  let overrides: Override[] = [];
  const mark = (id: string, field: string): void => {
    const entry = overrides.find(o => o.id === id);
    if (entry === undefined) overrides.push({ id, overriddenFields: [field] });
    else if (!entry.overriddenFields.includes(field)) entry.overriddenFields.push(field);
  };
  const store = new Map<string, Node>();
  const instance: Node = {
    id: 'I',
    type: 'INSTANCE',
    parent: null,
    removed: false,
    componentProperties: {},
    get overrides() {
      return overrides.map(o => ({ id: o.id, overriddenFields: [...o.overriddenFields] }));
    },
    removeOverrides: vi.fn<() => void>(() => {
      overrides = [];
      for (const n of store.values()) (n.reset as (() => void) | undefined)?.();
    }),
    findAllWithCriteria: () =>
      [...store.values()].filter(n => n.type === 'INSTANCE' && n.id !== 'I'),
    findAll: () => [...store.values()].filter(n => n.id.startsWith('I;')),
  };
  store.set('I', instance);
  const sublayer = (
    id: string,
    initial: Record<string, unknown>,
    hidden: readonly string[] = [],
  ): Node => {
    let state = { ...initial };
    const node: Node = {
      id,
      type: 'RECTANGLE',
      parent: instance,
      reset: () => (state = { ...initial }),
    };
    for (const field of Object.keys(initial)) {
      Object.defineProperty(node, field, {
        enumerable: true,
        get: () => state[field],
        set: (v: unknown) => {
          state = { ...state, [field]: v };
          if (!hidden.includes(field)) mark(id, field);
        },
      });
    }
    store.set(id, node);
    return node;
  };
  const loadBrushesAsync = vi.fn<(kind: string) => Promise<void>>(async () => {});
  const figmaCtx = {
    getNodeByIdAsync: async (id: string) => store.get(id) ?? null,
    variables: { getVariableByIdAsync: async (id: string) => ({ id }) },
    loadBrushesAsync,
  } as unknown as typeof figma;
  /** Record an override of a field the guard has no writer for (as Figma would list it). */
  const markRaw = (id: string, field: string): void => mark(id, field);
  /** The main component's layer an instance layer `I;<id>` takes its values from. */
  const source = (id: string, fields: Record<string, unknown>): void => {
    store.set(id, { id, type: 'RECTANGLE', ...fields });
  };
  return { instance, sublayer, store, figmaCtx, markRaw, source, loadBrushesAsync };
};

const TURNED = { type: 'FIXED_ORDER', translateZ: 0, rotateX: 0, rotateY: 30, rotateZ: 0 };
const FLAT = { type: 'NONE' };
const DYNAMIC = { type: 'DYNAMIC', frequency: 5, wiggle: 3, smoothen: 0.5 };
const BASIC = { type: 'BASIC' };
const TRACK = { OPACITY: { keyframes: [{ id: 'k1', timelinePosition: 0 }] } };

/** A sublayer's Motion, as Figma reads it, from a fixed state. */
const motion = (styles: unknown[], tracks: Record<string, unknown>) => ({
  animationStyles: styles,
  manualKeyframeTracks: tracks,
});

describe('instance override guard', () => {
  it('resets the instance and re-applies only the overrides it had, when an undo left a mark', async () => {
    const { instance, sublayer, figmaCtx } = makeInstance();
    const a = sublayer('I;1', { fills: ['red'], name: 'A' });
    const b = sublayer('I;2', { fills: ['red'], name: 'B' });
    b.name = 'Renamed'; // an override the instance already had

    const guards = await captureOverrideGuard(figmaCtx, ['I;1']);
    a.fills = ['blue']; // the op
    a.fills = ['red']; // the value restore — right value, but now marked overridden
    expect(instance.overrides).toContainEqual({ id: 'I;1', overriddenFields: ['fills'] });

    const note = await restoreOverrideGuard(figmaCtx, guards);

    expect(note).toBeUndefined();
    expect(instance.removeOverrides).toHaveBeenCalledOnce();
    expect(instance.overrides).toEqual([{ id: 'I;2', overriddenFields: ['name'] }]);
    expect(b.name).toBe('Renamed');
    expect(a.fills).toEqual(['red']);
  });

  it('leaves an instance alone when its override list already matches', async () => {
    const { instance, sublayer, figmaCtx } = makeInstance();
    sublayer('I;1', { fills: ['red'] });
    const guards = await captureOverrideGuard(figmaCtx, ['I;1']);

    expect(await restoreOverrideGuard(figmaCtx, guards)).toBeUndefined();
    expect(instance.removeOverrides).not.toHaveBeenCalled();
  });

  it('never resets an instance carrying an override it cannot re-apply — it names the residue', async () => {
    // Resetting would wipe the vector edit with no way to put it back; the residue is the lesser harm.
    const { instance, sublayer, figmaCtx, markRaw } = makeInstance();
    const a = sublayer('I;1', { fills: ['red'] });
    sublayer('I;2', { fills: ['red'] });
    markRaw('I;2', 'vectorNetwork');

    const guards = await captureOverrideGuard(figmaCtx, ['I;1']);
    a.fills = ['blue'];
    a.fills = ['red'];
    const note = await restoreOverrideGuard(figmaCtx, guards);

    expect(instance.removeOverrides).not.toHaveBeenCalled();
    expect(note).toMatch(/instance I keeps override marks \[\+I;1\.fills\]/);
    expect(note).toMatch(/I;2\.vectorNetwork/);
  });

  // Measured: a nested instance whose properties were set through the outer one is listed as an
  // override of 'componentProperties'; once its component set has errors, Figma throws on reading
  // them, and every batch touching the outer instance failed at capture.
  it('passes over a nested instance whose component set has errors, and names it if a reset is needed', async () => {
    const { instance, sublayer, store, figmaCtx, markRaw } = makeInstance();
    const a = sublayer('I;1', { fills: ['red'] });
    // Its main component still resolves on a broken set (measured); only the properties are withheld.
    const nested: Node = {
      id: 'I;2',
      type: 'INSTANCE',
      parent: instance,
      getMainComponentAsync: async () => ({ id: 'M' }),
    };
    Object.defineProperty(nested, 'componentProperties', {
      get: () => {
        throw new Error('in get_componentProperties: Component set for node has existing errors');
      },
    });
    store.set('I;2', nested);
    markRaw('I;2', 'componentProperties');

    const guards = await captureOverrideGuard(figmaCtx, ['I;1']);
    a.fills = ['blue'];
    a.fills = ['red'];
    const note = await restoreOverrideGuard(figmaCtx, guards);

    expect(instance.removeOverrides).not.toHaveBeenCalled();
    expect(note).toMatch(/I;2\.componentProperties \(Component set for node has existing errors\)/);
  });

  it('re-applies a nested swap the reset reverted', async () => {
    const { store, sublayer, figmaCtx } = makeInstance();
    const main1 = { id: 'M1', type: 'COMPONENT' };
    const main2 = { id: 'M2', type: 'COMPONENT' };
    store.set('M1', main1);
    store.set('M2', main2);
    let main: { id: string } = main2; // swapped before the batch
    const nested: Node = {
      id: 'I;3',
      type: 'INSTANCE',
      getMainComponentAsync: async () => main,
      swapComponent: vi.fn<(c: { id: string }) => void>(c => {
        main = c;
      }),
      reset: () => {
        main = main1; // removeOverrides reverts the swap
      },
    };
    store.set('I;3', nested);
    const a = sublayer('I;1', { fills: ['red'] });

    const guards = await captureOverrideGuard(figmaCtx, ['I;1']);
    a.fills = ['blue'];
    a.fills = ['red'];
    await restoreOverrideGuard(figmaCtx, guards);

    expect(nested.swapComponent).toHaveBeenCalledWith(main2);
    expect(main).toBe(main2);
  });

  it('guards nothing for a node outside any instance', async () => {
    const figmaCtx = {
      getNodeByIdAsync: async () => ({ id: '1:1', type: 'RECTANGLE', parent: null }),
    } as unknown as typeof figma;
    expect(await captureOverrideGuard(figmaCtx, ['1:1'])).toEqual([]);
  });
});

/** One op on `I;1` — write `field`, then write the old value back, as an inverse does — then undo. */
const opThenUndo = async (
  ctx: ReturnType<typeof makeInstance>,
  target: Node,
  field: string,
  value: unknown,
  hidden = false,
): Promise<string | undefined> => {
  const guards = await captureOverrideGuard(ctx.figmaCtx, [target.id], hidden);
  const was = target[field];
  target[field] = value;
  target[field] = was;
  return restoreOverrideGuard(ctx.figmaCtx, guards);
};

describe('hidden instance overrides (fields Figma never lists, yet a reset erases)', () => {
  it('writes back a 3D transform, scene, stroke and width profile the reset put back to the main', async () => {
    const ctx = makeInstance();
    const a = ctx.sublayer('I;1', { fills: ['red'] });
    const b = ctx.sublayer(
      'I;2',
      {
        transform3d: FLAT,
        transformOrigin: { x: { unit: 'PERCENT', value: 50 }, y: { unit: 'PERCENT', value: 50 } },
        scene3d: null,
        complexStrokeProperties: BASIC,
        variableWidthStrokeProperties: { widthProfile: 'UNIFORM' },
        textPathStartData: { segment: 0, position: 0 },
      },
      [
        'transform3d',
        'transformOrigin',
        'scene3d',
        'complexStrokeProperties',
        'variableWidthStrokeProperties',
        'textPathStartData',
      ],
    );
    // The instance's own values, set before the batch: none of them shows in its override list.
    b.transform3d = TURNED;
    b.transformOrigin = { x: { unit: 'PIXELS', value: 0 }, y: { unit: 'PERCENT', value: 50 } };
    b.scene3d = { perspective: 400, preserve3d: true, visible: true };
    b.complexStrokeProperties = DYNAMIC;
    b.variableWidthStrokeProperties = { widthProfile: 'CUSTOM', variableWidthPoints: [1, 2] };
    b.textPathStartData = { segment: 1, position: 0.5 };
    expect(ctx.instance.overrides).toEqual([]);

    const note = await opThenUndo(ctx, a, 'fills', ['blue']);

    expect(note).toBeUndefined();
    expect(ctx.instance.removeOverrides).toHaveBeenCalledOnce();
    expect(b.transform3d).toEqual(TURNED);
    expect(b.transformOrigin).toEqual({
      x: { unit: 'PIXELS', value: 0 },
      y: { unit: 'PERCENT', value: 50 },
    });
    expect(b.scene3d).toEqual({ perspective: 400, preserve3d: true, visible: true });
    expect(b.complexStrokeProperties).toEqual(DYNAMIC);
    expect(b.variableWidthStrokeProperties).toEqual({
      widthProfile: 'CUSTOM',
      variableWidthPoints: [1, 2],
    });
    expect(b.textPathStartData).toEqual({ segment: 1, position: 0.5 });
    expect(ctx.instance.overrides).toEqual([]);
  });

  it('writes back the instance’s own hidden fields too, not only its layers’', async () => {
    const ctx = makeInstance();
    const a = ctx.sublayer('I;1', { fills: ['red'] });
    let scene: unknown = null;
    Object.defineProperty(ctx.instance, 'scene3d', {
      get: () => scene,
      set: (v: unknown) => {
        scene = v;
      },
    });
    const reset = ctx.instance.removeOverrides as () => void;
    ctx.instance.removeOverrides = vi.fn<() => void>(() => {
      reset();
      scene = null;
    });
    scene = { perspective: 900, preserve3d: false, visible: true };

    expect(await opThenUndo(ctx, a, 'fills', ['blue'])).toBeUndefined();

    expect(ctx.instance.removeOverrides).toHaveBeenCalledOnce();
    expect(scene).toEqual({ perspective: 900, preserve3d: false, visible: true });
  });

  it('writes only what the reset changed, so an inherited value is left inheriting', async () => {
    const ctx = makeInstance();
    const a = ctx.sublayer('I;1', { fills: ['red'] });
    const writes: unknown[] = [];
    const b: Node = { id: 'I;2', type: 'RECTANGLE', parent: ctx.instance };
    Object.defineProperty(b, 'transform3d', {
      enumerable: true,
      get: () => TURNED, // the main's value, which a reset leaves as it is
      set: (v: unknown) => {
        writes.push(v);
      },
    });
    ctx.store.set('I;2', b);

    await opThenUndo(ctx, a, 'fills', ['blue']);

    expect(ctx.instance.removeOverrides).toHaveBeenCalledOnce();
    expect(writes).toEqual([]);
  });

  it('loads a brush’s kind before writing it back', async () => {
    const ctx = makeInstance();
    const a = ctx.sublayer('I;1', { fills: ['red'] });
    const brush = { type: 'BRUSH', brushType: 'SCATTER', brushName: 'MARKER' };
    const b = ctx.sublayer('I;2', { complexStrokeProperties: BASIC }, ['complexStrokeProperties']);
    b.complexStrokeProperties = brush;

    await opThenUndo(ctx, a, 'fills', ['blue']);

    expect(ctx.loadBrushesAsync).toHaveBeenCalledWith('SCATTER');
    expect(b.complexStrokeProperties).toEqual(brush);
  });

  it('writes onto the layer that replaced one the reset swapped out, found again by its id', async () => {
    // Putting a nested swap back replaces the layers under it: the objects read before the reset
    // report `removed`, and their ids name the new ones.
    const ctx = makeInstance();
    const a = ctx.sublayer('I;1', { fills: ['red'] });
    const old: Node = { id: 'I;2', type: 'RECTANGLE', parent: ctx.instance, transform3d: TURNED };
    const replacement: Node = { id: 'I;2', type: 'RECTANGLE', parent: ctx.instance };
    let value: unknown = FLAT;
    Object.defineProperty(replacement, 'transform3d', {
      enumerable: true,
      get: () => value,
      set: (v: unknown) => {
        value = v;
      },
    });
    old.reset = () => {
      old.removed = true;
      ctx.store.set('I;2', replacement);
    };
    ctx.store.set('I;2', old);

    expect(await opThenUndo(ctx, a, 'fills', ['blue'])).toBeUndefined();
    expect(value).toEqual(TURNED);
  });

  it('names a hidden field that would not go back', async () => {
    const ctx = makeInstance();
    const a = ctx.sublayer('I;1', { fills: ['red'] });
    let value: unknown = TURNED;
    const b: Node = { id: 'I;2', type: 'RECTANGLE', parent: ctx.instance };
    Object.defineProperty(b, 'transform3d', {
      enumerable: true,
      get: () => value,
      set: () => {
        throw new Error('refused');
      },
    });
    b.reset = () => (value = FLAT);
    ctx.store.set('I;2', b);

    const note = await opThenUndo(ctx, a, 'fills', ['blue']);

    expect(note).toMatch(/instance I: did not come back after reset: I;2\.transform3d/);
  });

  it('resets after an op that wrote a hidden field, though the override list never changed', async () => {
    // Writing the old value back leaves it the instance's own (measured), where it had followed
    // the main component; only a reset makes it inherit again.
    const ctx = makeInstance();
    const b = ctx.sublayer('I;1', { transform3d: TURNED }, ['transform3d']);

    const note = await opThenUndo(ctx, b, 'transform3d', FLAT, true);

    expect(note).toBeUndefined();
    expect(ctx.instance.removeOverrides).toHaveBeenCalledOnce();
    expect(b.transform3d).toEqual(TURNED);
  });

  it('does not reset for an ordinary op that left the list as it was', async () => {
    const ctx = makeInstance();
    const b = ctx.sublayer('I;1', { transform3d: TURNED }, ['transform3d']);

    expect(await opThenUndo(ctx, b, 'transform3d', FLAT, false)).toBeUndefined();
    expect(ctx.instance.removeOverrides).not.toHaveBeenCalled();
  });

  it('forces only the outermost instance — the one holding an override made anywhere inside it', async () => {
    const ctx = makeInstance();
    const inner: Node = {
      id: 'I;5',
      type: 'INSTANCE',
      parent: ctx.instance,
      overrides: [],
      removeOverrides: vi.fn<() => void>(),
      findAll: () => [],
      findAllWithCriteria: () => [],
      componentProperties: {},
      getMainComponentAsync: async () => ({ id: 'M5' }),
    };
    ctx.store.set('I;5', inner);
    const leaf: Node = { id: 'I;5;1', type: 'RECTANGLE', parent: inner, transform3d: TURNED };
    ctx.store.set('I;5;1', leaf);

    const guards = await captureOverrideGuard(ctx.figmaCtx, ['I;5;1'], true);

    expect(guards.map(g => [g.instanceId, g.hidden])).toEqual([
      ['I;5', false],
      ['I', true],
    ]);
  });

  it('a hidden op with a field it cannot re-apply leaves the value and says it no longer follows the main', async () => {
    const ctx = makeInstance();
    const b = ctx.sublayer('I;1', { transform3d: TURNED }, ['transform3d']);
    ctx.sublayer('I;2', { fills: ['red'] });
    ctx.markRaw('I;2', 'vectorNetwork');

    const note = await opThenUndo(ctx, b, 'transform3d', FLAT, true);

    expect(ctx.instance.removeOverrides).not.toHaveBeenCalled();
    expect(note).toMatch(
      /instance I keeps the value written back as one of its own — if it followed its main component before, it no longer does — it was not reset because it also overrides I;2\.vectorNetwork/,
    );
  });
});

describe('what a reset would erase that cannot be put back', () => {
  it('does not reset an instance with Motion of its own from before the batch', async () => {
    // Measured: removeOverrides() drops an animation style applied to the instance, and putting
    // Motion back gives it new ids.
    const ctx = makeInstance();
    Object.assign(ctx.instance, motion([{ id: 'AnimationPresetId:1' }], {}));
    const a = ctx.sublayer('I;1', { fills: ['red'] });

    const note = await opThenUndo(ctx, a, 'fills', ['blue']);

    expect(ctx.instance.removeOverrides).not.toHaveBeenCalled();
    expect(note).toMatch(
      /instance I keeps override marks \[\+I;1\.fills\] — it was not reset because a reset would also erase I \(its animation\)/,
    );
  });

  it('still resets when the batch itself added the instance’s Motion — its own undo removes it anyway', async () => {
    const ctx = makeInstance();
    const a = ctx.sublayer('I;1', { fills: ['red'] });
    const guards = await captureOverrideGuard(ctx.figmaCtx, ['I;1']);
    Object.assign(ctx.instance, motion([{ id: 'AnimationPresetId:2' }], {})); // an earlier op
    a.fills = ['blue'];
    a.fills = ['red'];

    expect(await restoreOverrideGuard(ctx.figmaCtx, guards)).toBeUndefined();
    expect(ctx.instance.removeOverrides).toHaveBeenCalledOnce();
  });

  /** An instance whose layer I;2 carries TRACK, its main component's layer `mainTracks`. */
  const animatedLayer = async (mainTracks: Record<string, unknown>) => {
    const ctx = makeInstance();
    const a = ctx.sublayer('I;1', { fills: ['red'] });
    const b = ctx.sublayer('I;2', { fills: ['red'] });
    Object.assign(b, motion([], TRACK));
    ctx.source('2', motion([], mainTracks));
    const note = await opThenUndo(ctx, a, 'fills', ['blue']);
    return { note, resets: (ctx.instance.removeOverrides as ReturnType<typeof vi.fn>).mock.calls };
  };

  it('does not reset over a layer’s own animation', async () => {
    const { note, resets } = await animatedLayer({});
    expect(resets).toHaveLength(0);
    expect(note).toMatch(/erase I;2 \(animation\)/);
  });

  it('resets over an animation the layer inherits — the reset leaves it in place (measured)', async () => {
    const { note, resets } = await animatedLayer(TRACK);
    expect(resets).toHaveLength(1);
    expect(note).toBeUndefined();
  });

  it('does not reset over a custom brush or an imported 3D transform of the layer’s own', async () => {
    const ctx = makeInstance();
    const a = ctx.sublayer('I;1', { fills: ['red'] });
    ctx.sublayer('I;2', {
      complexStrokeProperties: { type: 'BRUSH', brushType: 'STRETCH', brushName: 'CUSTOM' },
      transform3d: { type: 'FREEFORM', backfaceVisible: true },
    });
    ctx.source('2', { complexStrokeProperties: BASIC, transform3d: FLAT });

    const note = await opThenUndo(ctx, a, 'fills', ['blue']);

    expect(ctx.instance.removeOverrides).not.toHaveBeenCalled();
    expect(note).toMatch(/I;2 \(custom brush\), I;2 \(imported 3D transform\)/);
  });

  it('resets over a custom brush the layer inherits — the reset leaves it in place', async () => {
    const ctx = makeInstance();
    const custom = { type: 'BRUSH', brushType: 'STRETCH', brushName: 'CUSTOM' };
    const a = ctx.sublayer('I;1', { fills: ['red'] });
    ctx.sublayer('I;2', { complexStrokeProperties: custom });
    ctx.source('2', { complexStrokeProperties: custom });

    expect(await opThenUndo(ctx, a, 'fills', ['blue'])).toBeUndefined();
    expect(ctx.instance.removeOverrides).toHaveBeenCalledOnce();
  });

  it('takes a nested instance’s Motion as its own only after comparing it with its main’s', async () => {
    // A nested instance can inherit Motion from the main component's layer it comes from, which a
    // reset leaves in place; only Motion on an instance that is not inside another is its own.
    const ctx = makeInstance();
    const inner: Node = {
      id: 'I;5',
      type: 'INSTANCE',
      parent: ctx.instance,
      overrides: [],
      findAll: () => [],
      findAllWithCriteria: () => [],
      componentProperties: {},
      getMainComponentAsync: async () => ({ id: 'M5' }),
      ...motion([], TRACK),
    };
    ctx.store.set('I;5', inner);
    ctx.store.set('I;5;1', { id: 'I;5;1', type: 'RECTANGLE', parent: inner });

    const guards = await captureOverrideGuard(ctx.figmaCtx, ['I;5;1']);

    expect(guards.map(g => [g.instanceId, g.animated])).toEqual([
      ['I;5', false],
      ['I', false],
    ]);
  });

  it('treats a layer with no main-component counterpart as holding its own', async () => {
    const ctx = makeInstance();
    const a = ctx.sublayer('I;1', { fills: ['red'] });
    const b = ctx.sublayer('I;2', { fills: ['red'] });
    Object.assign(b, motion([], TRACK)); // and no source '2' in the store

    const note = await opThenUndo(ctx, a, 'fills', ['blue']);

    expect(ctx.instance.removeOverrides).not.toHaveBeenCalled();
    expect(note).toMatch(/erase I;2 \(animation\)/);
  });
});
