import { readComponentGetter } from '../serializer.js';
import { animatedBefore, readHidden, restoreHidden, unrestorable } from './batch-hidden.js';
import {
  type BindingSnapshot,
  captureBindings,
  captureText,
  loadFonts,
  rebind,
  restorable,
  restoreText,
  same,
  type TextSnapshot,
} from './batch-snapshot.js';
import { writePaints } from './paints.js';
import { isTextLike } from './text-like.js';

/**
 * Instance override guard.
 *
 * Writing an instance sublayer's field back to the value it had does not make it inherit again —
 * measured: the field stays in `instance.overrides`, so the next change to the main component no
 * longer reaches it. Figma has no per-field reset; `removeOverrides()` clears every direct override
 * on the instance. Also measured: `removeOverrides()` followed by re-applying the overrides the
 * instance had reproduces its override list exactly, a nested swap included (the swapped subtree's
 * sublayer ids come back once the swap is re-applied).
 *
 * So the guard snapshots, for every instance an op writes into, its override list, the value of
 * every overridden field, and the main component of every nested instance. On undo, if the list
 * changed, it resets and re-applies. A field with no verified writer is never guessed at: an
 * instance carrying one is left with the residue, and the rollback message names it.
 *
 * Some fields are never listed at all, yet the reset puts them back to the main's: a 3D transform
 * and scene, a dynamic stroke or brush, a width profile, a text path's start, and the instance's
 * own Motion (batch-hidden.ts). Their values are read just before a reset and written back after
 * it; an instance holding one that cannot be written back is not reset. Since an op that writes one
 * of them leaves no mark in the list, such an op (`hidden`) has its instance reset regardless: a
 * value written back stays the instance's own, where it had followed the main component.
 */

/** Overridden fields put back by plain assignment. */
const SIMPLE_FIELDS = new Set([
  'name',
  'visible',
  'opacity',
  'blendMode',
  'locked',
  'isMask',
  'maskType',
  'clipsContent',
  'constraints',
  'arcData',
  'innerRadius',
  'pointCount',
  'cornerRadius',
  'topLeftRadius',
  'topRightRadius',
  'bottomLeftRadius',
  'bottomRightRadius',
  'cornerSmoothing',
  'strokeWeight',
  'strokeAlign',
  'strokeCap',
  'strokeJoin',
  'strokeMiterLimit',
  'dashPattern',
  'strokeTopWeight',
  'strokeBottomWeight',
  'strokeLeftWeight',
  'strokeRightWeight',
  'fills',
  'strokes',
  'effects',
  'layoutGrids',
  'exportSettings',
  'layoutMode',
  'layoutWrap',
  'paddingLeft',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'itemSpacing',
  'counterAxisSpacing',
  'layoutAlign',
  'counterAxisSizingMode',
  'primaryAxisSizingMode',
  'primaryAxisAlignItems',
  'counterAxisAlignItems',
  'counterAxisAlignContent',
  'layoutGrow',
  'layoutPositioning',
  'itemReverseZIndex',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'x',
  'y',
  'rotation',
  'relativeTransform',
  'constrainProportions',
]);

/** Style-id overrides, written back through the async setters (the sync ones throw here). */
const STYLE_SETTERS: Readonly<Record<string, string>> = {
  fillStyleId: 'setFillStyleIdAsync',
  strokeStyleId: 'setStrokeStyleIdAsync',
  effectStyleId: 'setEffectStyleIdAsync',
  gridStyleId: 'setGridStyleIdAsync',
  textStyleId: 'setTextStyleIdAsync',
};

/** Text overrides: characters and runs go back through the text snapshot, the rest by assignment. */
const TEXT_FIELDS = new Set([
  'characters',
  'styledTextSegments',
  'fontName',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'paragraphIndent',
  'paragraphSpacing',
  'textWrapStyle',
  'listSpacing',
  'hyperlink',
  'textCase',
  'textDecoration',
  'textAutoResize',
  'textTruncation',
  'maxLines',
  'textAlignHorizontal',
  'textAlignVertical',
  'leadingTrim',
  'hangingPunctuation',
  'hangingList',
]);

/** `NodeChangeProperty` spells one per-side stroke weight without its first "r". */
const SPELLING: Readonly<Record<string, string>> = { stokeTopWeight: 'strokeTopWeight' };

interface Override {
  id: string;
  fields: string[];
}

interface Entry {
  id: string;
  fields: string[];
  values: Record<string, unknown>;
  text: TextSnapshot | null;
  bindings: BindingSnapshot;
}

export interface InstanceGuard {
  instanceId: string;
  depth: number;
  overrides: Override[];
  entries: Entry[];
  swaps: { id: string; mainId: string }[];
  unsupported: string[];
  /** Reset on undo even if the list is unchanged: an op wrote a field the list never shows. */
  hidden: boolean;
  /** Whether the instance had Motion of its own before the batch (see `animatedBefore`). */
  animated: boolean;
}

const byId = (a: Override, b: Override): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const normalize = (
  list: readonly { id: string; overriddenFields: readonly string[] }[],
): Override[] =>
  list.map(o => ({ id: o.id, fields: [...o.overriddenFields].toSorted() })).toSorted(byId);

const pairs = (list: readonly Override[]): Set<string> =>
  new Set(list.flatMap(o => o.fields.map(f => `${o.id}.${f}`)));

/** The `id.field` pairs one override list has and the other lacks, both ways. */
const describeDiff = (now: Override[], was: Override[]): string => {
  const [n, w] = [pairs(now), pairs(was)];
  const added = [...n].filter(p => !w.has(p));
  const lost = [...w].filter(p => !n.has(p));
  return [
    added.length > 0 ? `+${added.join(' +')}` : '',
    lost.length > 0 ? `-${lost.join(' -')}` : '',
  ]
    .filter(Boolean)
    .join(' ');
};

/** Every INSTANCE from `node` up, innermost first (a node that is itself an instance included). */
const instanceChain = (node: BaseNode): InstanceNode[] => {
  const chain: InstanceNode[] = [];
  // `?? null`: a node detached from the tree reports no parent at all rather than null.
  for (let cur: BaseNode | null = node; cur !== null; cur = cur.parent ?? null) {
    if (cur.type === 'INSTANCE') chain.push(cur);
  }
  return chain;
};

type PropertyValue = string | boolean | VariableAlias;

/** An instance's property values as `setProperties` takes them — a binding as its alias. */
const propertyValues = (inst: InstanceNode): Record<string, PropertyValue> => {
  const out: Record<string, PropertyValue> = {};
  for (const [key, prop] of Object.entries(inst.componentProperties)) {
    out[key] = prop.boundVariables?.value ?? prop.value;
  }
  return out;
};

const captureEntry = async (
  figmaCtx: typeof figma,
  node: BaseNode,
  override: Override,
  unsupported: string[],
): Promise<Entry> => {
  const bag = node as unknown as Record<string, unknown>;
  const entry: Entry = { id: override.id, fields: [], values: {}, text: null, bindings: {} };
  for (const raw of override.fields) {
    const field = SPELLING[raw] ?? raw;
    if (isTextLike(node) && TEXT_FIELDS.has(field)) {
      // eslint-disable-next-line no-await-in-loop -- once per node: the first text field captures it
      if (entry.text === null) entry.text = await captureText(figmaCtx, node);
      if (field !== 'characters' && field !== 'styledTextSegments')
        entry.values[field] = bag[field];
    } else if ((field === 'width' || field === 'height') && 'resizeWithoutConstraints' in node) {
      entry.values.width = (node as SceneNode).width;
      entry.values.height = (node as SceneNode).height;
    } else if (field === 'componentProperties' && node.type === 'INSTANCE') {
      // A nested instance whose component set has errors: Figma throws on reading its properties
      // and refuses setProperties on it alike (measured), so they can be neither captured nor put
      // back. Left as an override the guard will not reset — the batch runs, as it does outside one
      // — rather than failing every batch that touches the outer instance.
      const values = readComponentGetter(() => propertyValues(node));
      if ('error' in values) {
        unsupported.push(`${override.id}.${raw} (${values.error})`);
        continue;
      }
      entry.values.componentProperties = values.value;
    } else if (field === 'reactions' && 'reactions' in node) {
      entry.values.reactions = (node as ReactionMixin).reactions;
    } else if (
      (SIMPLE_FIELDS.has(field) || field in STYLE_SETTERS) &&
      field in node &&
      restorable(bag[field])
    ) {
      entry.values[field] = bag[field];
    } else {
      unsupported.push(`${override.id}.${raw}`);
      continue;
    }
    entry.fields.push(field);
  }
  entry.bindings = await captureBindings(figmaCtx, node, entry.fields);
  return entry;
};

const guardFor = async (
  figmaCtx: typeof figma,
  inst: InstanceNode,
  hidden: boolean,
): Promise<InstanceGuard> => {
  const overrides = normalize(inst.overrides);
  const unsupported: string[] = [];
  const nodes = await Promise.all(overrides.map(async o => figmaCtx.getNodeByIdAsync(o.id)));
  const captured = await Promise.all(
    overrides.map(async (o, i) => {
      const node = nodes[i] ?? null;
      if (node !== null) return captureEntry(figmaCtx, node, o, unsupported);
      unsupported.push(`${o.id} (unresolvable)`);
      return null;
    }),
  );
  const entries = captured.filter((entry): entry is Entry => entry !== null);
  // Document order, so a swapped instance is re-swapped before any instance nested under it is
  // looked up (its id only exists again once the outer swap is back).
  const nested = inst.findAllWithCriteria({ types: ['INSTANCE'] });
  const mains = await Promise.all(nested.map(async n => n.getMainComponentAsync()));
  const swaps = nested.flatMap((n, i) => {
    const main = mains[i];
    return main === null || main === undefined ? [] : [{ id: n.id, mainId: main.id }];
  });
  return {
    instanceId: inst.id,
    depth: instanceChain(inst).length,
    overrides,
    entries,
    swaps,
    unsupported,
    hidden,
    animated: animatedBefore(inst),
  };
};

/**
 * Snapshot the override state of every instance containing (or being) one of `ids`. `hidden`: the
 * op writes a field the override list never shows, so the outermost instance of each — the one that
 * holds an override made anywhere inside it — is reset on undo whatever its list says.
 */
export const captureOverrideGuard = async (
  figmaCtx: typeof figma,
  ids: readonly string[],
  hidden = false,
): Promise<InstanceGuard[]> => {
  const instances = new Map<string, InstanceNode>();
  const outermost = new Set<string>();
  const nodes = await Promise.all(ids.map(async id => figmaCtx.getNodeByIdAsync(id)));
  for (const node of nodes) {
    if (node === null) continue;
    const chain = instanceChain(node);
    for (const inst of chain) instances.set(inst.id, inst);
    if (chain.length > 0) outermost.add(chain.at(-1)!.id);
  }
  return Promise.all(
    [...instances.values()].map(async inst =>
      guardFor(figmaCtx, inst, hidden && outermost.has(inst.id)),
    ),
  );
};

const reswap = async (
  figmaCtx: typeof figma,
  swaps: readonly { id: string; mainId: string }[],
): Promise<void> => {
  /* eslint-disable no-await-in-loop -- document order: an outer swap must land before inner lookups */
  for (const s of swaps) {
    const node = await figmaCtx.getNodeByIdAsync(s.id);
    if (node?.type !== 'INSTANCE') continue;
    const main = await node.getMainComponentAsync();
    if (main?.id === s.mainId) continue;
    const component = await figmaCtx.getNodeByIdAsync(s.mainId);
    if (component?.type !== 'COMPONENT') {
      throw new Error(`component ${s.mainId} for nested instance ${s.id} no longer exists`);
    }
    node.swapComponent(component);
  }
  /* eslint-enable no-await-in-loop */
};

/**
 * Re-apply one node's overrides. Assignment is unconditional on purpose: after `removeOverrides()`
 * the field holds the main's value, and writing a value — even the same one — is what marks it
 * overridden again, which is exactly the state being reproduced.
 */
const reapply = async (figmaCtx: typeof figma, node: BaseNode, entry: Entry): Promise<void> => {
  const bag = node as unknown as Record<string, unknown>;
  if (entry.text !== null && isTextLike(node)) {
    if (entry.fields.includes('styledTextSegments')) {
      await restoreText(figmaCtx, node, entry.text);
    } else {
      const current =
        node.fontName === figmaCtx.mixed && node.characters.length > 0
          ? node.getRangeAllFontNames(0, node.characters.length)
          : [node.fontName as FontName];
      await loadFonts(figmaCtx, [...entry.text.fonts, ...current]);
      if (entry.fields.includes('characters')) node.characters = entry.text.characters;
    }
  }
  let sized = false;
  /* eslint-disable no-await-in-loop -- a node carries a handful of overrides; order is the capture's */
  for (const field of entry.fields) {
    if (field === 'characters' || field === 'styledTextSegments') continue;
    if (field === 'width' || field === 'height') {
      if (!sized) {
        (node as LayoutMixin).resizeWithoutConstraints(
          entry.values.width as number,
          entry.values.height as number,
        );
        sized = true;
      }
      continue;
    }
    const setter = STYLE_SETTERS[field];
    if (setter !== undefined) {
      await (bag[setter] as (id: unknown) => Promise<void>).call(node, entry.values[field]);
    } else if (field === 'componentProperties' && node.type === 'INSTANCE') {
      const want = entry.values.componentProperties as Record<string, PropertyValue>;
      const have = propertyValues(node);
      const changed = Object.fromEntries(
        Object.entries(want).filter(([key, value]) => !same(have[key], value)),
      );
      if (Object.keys(changed).length > 0) node.setProperties(changed);
    } else if (field === 'reactions') {
      await (node as ReactionMixin).setReactionsAsync(entry.values.reactions as Reaction[]);
    } else if ((field === 'fills' || field === 'strokes') && Array.isArray(entry.values[field])) {
      // Through the helper: a paint list holding a PATTERN refuses the synchronous setter.
      await writePaints(node, field, entry.values[field] as Paint[]);
    } else if (restorable(entry.values[field])) {
      bag[field] = entry.values[field];
    }
  }
  /* eslint-enable no-await-in-loop */
  rebind(node, entry.bindings);
};

/**
 * Put every guarded instance's override list back, outermost first (resetting an outer instance
 * also settles everything nested in it). Resolves to a note naming any residue left.
 */
export const restoreOverrideGuard = async (
  figmaCtx: typeof figma,
  guards: readonly InstanceGuard[],
): Promise<string | undefined> => {
  const notes: string[] = [];
  /* eslint-disable no-await-in-loop -- outer instances settle before inner ones are compared */
  for (const guard of [...guards].toSorted((a, b) => a.depth - b.depth)) {
    const inst = await figmaCtx.getNodeByIdAsync(guard.instanceId);
    if (inst?.type !== 'INSTANCE' || inst.removed) continue;
    const now = normalize(inst.overrides);
    const marked = !same(now, guard.overrides);
    if (!marked && !guard.hidden) continue;
    const residue = marked
      ? `keeps override marks [${describeDiff(now, guard.overrides)}]`
      : 'keeps the value written back as one of its own — if it followed its main component' +
        ' before, it no longer does';
    if (guard.unsupported.length > 0) {
      notes.push(
        `instance ${guard.instanceId} ${residue} — it was not reset because it also overrides` +
          ` ${guard.unsupported.join(', ')}, which have no verified writer`,
      );
      continue;
    }
    // Every layer, the instance itself first: read once, for both what a reset would erase and
    // what it changes that can be written back.
    const layers: readonly BaseNode[] = [inst, ...inst.findAll()];
    const hidden = readHidden(layers);
    const lost = await unrestorable(inst, layers, hidden, guard.animated);
    if (lost.length > 0) {
      notes.push(
        `instance ${guard.instanceId} ${residue} — it was not reset because a reset would also` +
          ` erase ${lost.join(', ')}, which the plugin API cannot set back`,
      );
      continue;
    }
    inst.removeOverrides();
    await reswap(figmaCtx, guard.swaps);
    for (const entry of guard.entries) {
      const node = await figmaCtx.getNodeByIdAsync(entry.id);
      if (node === null) {
        notes.push(`instance ${guard.instanceId}: sublayer ${entry.id} did not come back`);
        continue;
      }
      await reapply(figmaCtx, node, entry);
    }
    const missing = await restoreHidden(figmaCtx, hidden);
    if (missing.length > 0) {
      notes.push(
        `instance ${guard.instanceId}: did not come back after reset: ${missing.join(', ')}`,
      );
    }
    const after = normalize(inst.overrides);
    if (!same(after, guard.overrides)) {
      notes.push(
        `instance ${guard.instanceId}: override marks differ after reset [${describeDiff(after, guard.overrides)}]`,
      );
    }
  }
  /* eslint-enable no-await-in-loop */
  return notes.length === 0 ? undefined : notes.join('; ');
};
