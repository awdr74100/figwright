import { same } from './batch-snapshot.js';

/**
 * Hidden instance overrides: fields an instance layer can hold apart from its main component's that
 * Figma never lists in `instance.overrides`, yet `removeOverrides()` puts back to the main's.
 * Measured 2026-11-21, each written on an instance layer: listed nowhere, gone after the reset —
 * the guard's reset erased them while reporting the rollback as clean.
 *
 * Each of these is put back by assignment, in this order (a width profile before the stroke it
 * shapes). Written back after a reset they stay the instance's own (measured: the main component
 * changed afterwards, they kept their values).
 */
const HIDDEN_FIELDS = [
  'variableWidthStrokeProperties',
  'complexStrokeProperties',
  'transformOrigin',
  'transform3d',
  'scene3d',
  'textPathStartData',
] as const;

type HiddenField = (typeof HIDDEN_FIELDS)[number];
type Values = Partial<Record<HiddenField, unknown>>;

/** One layer's hidden fields as they stood before a reset. */
export interface HiddenLayer {
  id: string;
  /** The layer as read; a reset keeps it, except where a nested swap is put back (`removed`). */
  node: BaseNode;
  values: Values;
}

type Bag = Record<string, unknown>;

/** Figma hands out frozen objects; a plain copy compares and assigns back the same. */
const plain = (value: unknown): unknown =>
  value === null || typeof value !== 'object'
    ? value
    : (JSON.parse(JSON.stringify(value)) as unknown);

const readValues = (node: BaseNode): Values => {
  const bag = node as unknown as Bag;
  const values: Values = {};
  for (const field of HIDDEN_FIELDS) {
    if (!(field in node)) continue;
    const value = bag[field];
    if (value !== undefined && typeof value !== 'symbol') values[field] = plain(value);
  }
  return values;
};

/** Every one of an instance's `layers` (itself included) holding a hidden field, as it stands. */
export const readHidden = (layers: readonly BaseNode[]): HiddenLayer[] =>
  layers
    .map(node => ({ id: node.id, node, values: readValues(node) }))
    .filter(layer => Object.keys(layer.values).length > 0);

/** A layer's Motion — applied styles and hand-made tracks — as one comparable string, or null. */
const motionOf = (node: BaseNode): string | null => {
  if (!('animationStyles' in node) || !('manualKeyframeTracks' in node)) return null;
  try {
    const m = node as unknown as { animationStyles: unknown[]; manualKeyframeTracks: Bag };
    if (m.animationStyles.length === 0 && Object.keys(m.manualKeyframeTracks).length === 0) {
      return null;
    }
    return JSON.stringify([m.animationStyles, m.manualKeyframeTracks]);
  } catch {
    return null; // Motion unavailable in this editor: nothing a reset could erase
  }
};

/**
 * Whether an instance carries Motion of its own — read at capture, before any op ran. Only an
 * instance that is not itself a layer of another instance is asked: its main component cannot be
 * animated (refused through the API and in Figma's own panel, measured), so any Motion it has is
 * its own, and a reset erases it (measured, an applied animation style). Animating a layer of an
 * instance is refused through the API, so no op can add Motion anywhere else in one.
 */
export const animatedBefore = (inst: InstanceNode): boolean =>
  !inst.id.includes(';') && motionOf(inst) !== null;

/** The layer an instance layer takes its values from: its main component's, or the main itself. */
const sourceOf = async (figmaCtx: typeof figma, node: BaseNode): Promise<BaseNode | null> => {
  const segments = node.id.split(';');
  if (segments.length > 1) return figmaCtx.getNodeByIdAsync(segments.at(-1)!);
  return node.type === 'INSTANCE' ? (node as InstanceNode).getMainComponentAsync() : null;
};

/**
 * What a reset of `inst` would erase that cannot be written back, named for the rollback note. A
 * custom brush and an imported FREEFORM transform cannot be set through the API, and Motion put
 * back gets new ids (measured) — so an instance holding any of them as its own is not reset.
 *
 * Only a layer's own value counts: what it inherits comes back with the reset (measured: an
 * inherited track, ids and all). So each is compared with the layer it comes from in its main
 * component. The instance's own Motion was settled at capture (`animated`), since an op in the
 * batch may have added some, which the reset may take with it.
 */
export const unrestorable = async (
  figmaCtx: typeof figma,
  inst: InstanceNode,
  layers: readonly BaseNode[],
  hidden: readonly HiddenLayer[],
  animated: boolean,
): Promise<string[]> => {
  const out: string[] = [];
  if (animated) out.push(`${inst.id} (its animation)`);
  const byId = new Map(hidden.map(layer => [layer.id, layer.values]));
  for (const node of layers) {
    const values = byId.get(node.id);
    const complex = values?.complexStrokeProperties as
      | { type?: unknown; brushName?: unknown }
      | null
      | undefined;
    const transform = values?.transform3d as { type?: unknown } | undefined;
    const suspects: [string, (n: BaseNode) => unknown][] = [];
    if (complex?.type === 'BRUSH' && complex.brushName === 'CUSTOM') {
      suspects.push(['custom brush', n => plain((n as unknown as Bag).complexStrokeProperties)]);
    }
    if (transform?.type === 'FREEFORM') {
      suspects.push(['imported 3D transform', n => plain((n as unknown as Bag).transform3d)]);
    }
    // The instance itself was judged at capture when it is not inside another instance.
    if (node !== inst || inst.id.includes(';')) {
      if (motionOf(node) !== null) suspects.push(['animation', motionOf]);
    }
    if (suspects.length === 0) continue;
    // eslint-disable-next-line no-await-in-loop -- only for the rare layer holding one of these
    const source = await sourceOf(figmaCtx, node);
    for (const [label, read] of suspects) {
      if (source === null || !same(read(node), read(source))) out.push(`${node.id} (${label})`);
    }
  }
  return out;
};

const write = async (
  figmaCtx: typeof figma,
  node: BaseNode,
  field: HiddenField,
  value: unknown,
): Promise<void> => {
  const bag = node as unknown as Bag;
  if (field === 'variableWidthStrokeProperties') {
    if (value === null) throw new Error('no width profile to write back');
    const w = value as { widthProfile: string; variableWidthPoints?: unknown };
    bag[field] =
      w.widthProfile === 'CUSTOM'
        ? { widthProfile: 'CUSTOM', variableWidthPoints: w.variableWidthPoints }
        : { widthProfile: w.widthProfile };
    return;
  }
  if (field === 'complexStrokeProperties') {
    const c = value as { type?: unknown; brushType?: unknown };
    // A brush can only be set once its kind is loaded (as set_complex_stroke does).
    if (c.type === 'BRUSH') await figmaCtx.loadBrushesAsync(c.brushType as 'STRETCH' | 'SCATTER');
  }
  bag[field] = value;
};

/**
 * After a reset, write back every hidden field the reset changed. Resolves to what did not come
 * back, if anything.
 */
export const restoreHidden = async (
  figmaCtx: typeof figma,
  before: readonly HiddenLayer[],
): Promise<string[]> => {
  const problems: string[] = [];
  /* eslint-disable no-await-in-loop -- one layer at a time, in document order */
  for (const layer of before) {
    // Looked up again only when the reset replaced it: a 205-layer instance took 13 ms to look up.
    const node = layer.node.removed ? await figmaCtx.getNodeByIdAsync(layer.id) : layer.node;
    if (node === null) {
      problems.push(`${layer.id} did not come back`);
      continue;
    }
    const now = readValues(node);
    const written = HIDDEN_FIELDS.filter(
      field => field in layer.values && !same(now[field], layer.values[field]),
    );
    for (const field of written) {
      try {
        await write(figmaCtx, node, field, layer.values[field]);
      } catch {
        // Reported below, with every other field that did not come back.
      }
    }
    if (written.length === 0) continue;
    const after = readValues(node);
    const off = written.filter(field => !same(after[field], layer.values[field]));
    if (off.length > 0) problems.push(off.map(field => `${layer.id}.${field}`).join(', '));
  }
  /* eslint-enable no-await-in-loop */
  return problems;
};
