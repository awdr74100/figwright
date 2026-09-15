import { describe, expect, it, vi } from 'vitest';

import { captureOverrideGuard, restoreOverrideGuard } from '../../src/handlers/batch-overrides.js';

type Override = { id: string; overriddenFields: string[] };
type Node = Record<string, unknown> & { id: string };

/**
 * An instance that behaves like Figma's where the guard depends on it (measured): writing a
 * sublayer field — even its current value — marks it overridden; removeOverrides() puts every
 * sublayer back to its main's values, clears the list, and reverts nested swaps.
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
  };
  store.set('I', instance);
  const sublayer = (id: string, initial: Record<string, unknown>): Node => {
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
          mark(id, field);
        },
      });
    }
    store.set(id, node);
    return node;
  };
  const figmaCtx = {
    getNodeByIdAsync: async (id: string) => store.get(id) ?? null,
    variables: { getVariableByIdAsync: async (id: string) => ({ id }) },
  } as unknown as typeof figma;
  /** Record an override of a field the guard has no writer for (as Figma would list it). */
  const markRaw = (id: string, field: string): void => mark(id, field);
  return { instance, sublayer, store, figmaCtx, markRaw };
};

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
