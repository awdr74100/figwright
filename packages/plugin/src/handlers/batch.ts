import type { BatchResult } from '@figwright/shared';

import type { SandboxHandlers, SandboxToolHandler } from '../dispatcher.js';
import {
  captureOverrideGuard,
  type InstanceGuard,
  restoreOverrideGuard,
} from './batch-overrides.js';
import {
  type BindingSnapshot,
  captureBindings,
  captureGeometry,
  captureLayoutScope,
  captureOrder,
  capturePlacement,
  captureProps,
  captureText,
  type GeometrySnapshot,
  type LayoutScope,
  loadFonts,
  type Placement,
  type PropsSnapshot,
  rebind,
  restoreGeometry,
  restoreLayoutDrift,
  restoreOrder,
  restoreProps,
  restoreText,
  same,
  type TextSnapshot,
  unbindAdded,
  writeIfDifferent,
} from './batch-snapshot.js';
import { propertyDisplayName, resolveComponentOwner } from './component-property.js';
import { findReplacePlan } from './find-replace-text.js';
import {
  assertFigmaEditor,
  assertKeyframeField,
  isMotionNode,
  toPlainJson,
} from './motion-shared.js';

/**
 * Atomic batch: apply several invertible write ops as a unit. Two phases —
 *
 * 1. Capture (read-only): resolve every op's target and snapshot what undo needs. Any failure here
 *    aborts before a single mutation, so a bad op id never leaves the document half-changed.
 * 2. Apply: run the real write handlers in order; if one throws, undo the already-applied ops in
 *    reverse and reject. Reuses the existing handlers for apply so there is no second copy of the
 *    mutation logic — this module only adds the inverse (undo) for each invertible op.
 *
 * An op joins only if it has a faithful inverse — one that puts the document back as it was, not
 * merely the values the op wrote (see batch-snapshot.ts for what "as it was" was measured to take).
 * Ops that cannot be undone that way — anything that deletes a node, style, variable or property,
 * whose id cannot come back — are rejected at validate time with the reason (NON_BATCHABLE), and op
 * shapes that would lose an id (emptying a group Figma then deletes, a variant leaving its set) are
 * rejected at capture, before anything runs.
 */

/** Per-op inverse. `capture` runs before any mutation; `undo` restores the pre-op state on rollback. */
interface BatchInverse {
  /**
   * Read-only: validate the target and snapshot whatever `undo` will need. Throw to abort the
   * batch.
   */
  capture(figmaCtx: typeof figma, params: unknown): Promise<unknown>;
  /**
   * Restore the pre-op state. Receives the capture snapshot and the op's apply result. Resolves to
   * a note (a string) when something could not be put back exactly; anything else means it was.
   */
  undo(
    figmaCtx: typeof figma,
    params: unknown,
    captured: unknown,
    result: unknown,
  ): Promise<unknown>;
  /** Nodes the op writes: any instance containing one has its override list guarded. */
  touches?(params: unknown, captured: unknown): readonly string[];
  /** Nodes whose box the op can change: the layout region around each is guarded against drift. */
  resizes?(params: unknown, captured: unknown): readonly string[];
  /** For ops that move nodes between containers: which nodes, and where to (null = a new one). */
  moves?(figmaCtx: typeof figma, params: unknown): Promise<Move>;
}

interface Move {
  nodeIds: readonly string[];
  destinationId: string | null;
}

type Bag = Record<string, unknown>;

const paramsOf = (params: unknown): Bag => (params ?? {}) as Bag;

const stringParam = (params: unknown, key: string, tool: string): string => {
  const value = paramsOf(params)[key];
  if (typeof value !== 'string') throw new TypeError(`batch/${tool}: ${key} must be a string`);
  return value;
};

const stringsParam = (params: unknown, key: string, tool: string): string[] => {
  const value = paramsOf(params)[key];
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) {
    throw new TypeError(`batch/${tool}: ${key} must be a string[]`);
  }
  return value as string[];
};

const nodeOf = async (figmaCtx: typeof figma, id: string, tool: string): Promise<BaseNode> => {
  const node = await figmaCtx.getNodeByIdAsync(id);
  if (node === null) throw new Error(`batch/${tool}: node ${id} not found`);
  return node;
};

/** The node, unless it is gone — an undo whose target vanished has nothing left to restore. */
const live = async (figmaCtx: typeof figma, id: string): Promise<BaseNode | null> => {
  const node = await figmaCtx.getNodeByIdAsync(id);
  return node === null || (node as { removed?: boolean }).removed === true ? null : node;
};

const notesOf = (notes: readonly unknown[]): string | undefined => {
  const text = notes.filter((n): n is string => typeof n === 'string');
  return text.length === 0 ? undefined : text.join('; ');
};

// ── Single-node properties ───────────────────────────────────────────────────

interface PropsState {
  id: string;
  props: PropsSnapshot;
  text: TextSnapshot | null;
}

interface PropsOptions {
  /** The params key naming the node (default `nodeId`). */
  idKey?: string;
  /** Node fields whose variable bindings the write can drop (default: `props` themselves). */
  bindings?: readonly string[];
  /** Whether the write can change the node's box (and so move its neighbours). */
  resizes?: boolean;
}

/**
 * Single-node op: snapshot `props` (plus the styles and bindings they carry) and restore them on
 * undo. props[0] is required. A TEXT node's fills live per run, so a fills write on text also
 * snapshots the runs.
 */
const propsInverse = (
  tool: string,
  props: readonly string[],
  opts: PropsOptions = {},
): BatchInverse => ({
  async capture(figmaCtx, params) {
    const id = stringParam(params, opts.idKey ?? 'nodeId', tool);
    const node = await nodeOf(figmaCtx, id, tool);
    const required = props[0]!;
    if (!(required in node)) throw new Error(`batch/${tool}: node ${id} has no ${required}`);
    const state: PropsState = {
      id,
      props: await captureProps(figmaCtx, node, props, opts.bindings ?? props),
      text:
        node.type === 'TEXT' && props.includes('fills') ? await captureText(figmaCtx, node) : null,
    };
    return state;
  },
  async undo(figmaCtx, _params, captured) {
    const { id, props: snapshot, text } = captured as PropsState;
    const node = await live(figmaCtx, id);
    if (node === null) return undefined;
    await restoreProps(node, snapshot);
    return text === null ? undefined : restoreText(figmaCtx, node as TextNode, text);
  },
  touches: (_params, captured) => [(captured as PropsState).id],
  ...(opts.resizes === true && {
    resizes: (_params: unknown, captured: unknown) => [(captured as PropsState).id],
  }),
});

const STROKE_WEIGHTS = [
  'strokeWeight',
  'strokeTopWeight',
  'strokeRightWeight',
  'strokeBottomWeight',
  'strokeLeftWeight',
];
const CORNERS = [
  'cornerRadius',
  'topLeftRadius',
  'topRightRadius',
  'bottomRightRadius',
  'bottomLeftRadius',
];

// ── Text ─────────────────────────────────────────────────────────────────────

interface TextState {
  id: string;
  text: TextSnapshot;
}

/** Text op: snapshot the node's characters, every run and its node-level settings. */
const textInverse = (tool: string): BatchInverse => ({
  async capture(figmaCtx, params) {
    const id = stringParam(params, 'nodeId', tool);
    const node = await nodeOf(figmaCtx, id, tool);
    if (node.type !== 'TEXT') throw new Error(`batch/${tool}: node ${id} is not a TEXT node`);
    const state: TextState = { id, text: await captureText(figmaCtx, node) };
    return state;
  },
  async undo(figmaCtx, _params, captured) {
    const { id, text } = captured as TextState;
    const node = await live(figmaCtx, id);
    return node?.type === 'TEXT' ? restoreText(figmaCtx, node, text) : undefined;
  },
  touches: (_params, captured) => [(captured as TextState).id],
  resizes: (_params, captured) => [(captured as TextState).id],
});

/** Find_replace_text rewrites every matching TEXT node under a scope; snapshot exactly those. */
const findReplaceInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    const { matches } = await findReplacePlan(figmaCtx, params, 'batch/find_replace_text');
    return Promise.all(
      matches.map(async t => ({ id: t.id, text: await captureText(figmaCtx, t) })),
    );
  },
  async undo(figmaCtx, _params, captured) {
    const notes: unknown[] = [];
    /* eslint-disable no-await-in-loop -- font loads and style setters are awaited per node */
    for (const { id, text } of captured as TextState[]) {
      const node = await live(figmaCtx, id);
      if (node?.type === 'TEXT') notes.push(await restoreText(figmaCtx, node, text));
    }
    /* eslint-enable no-await-in-loop */
    return notesOf(notes);
  },
  touches: (_params, captured) => (captured as TextState[]).map(t => t.id),
  resizes: (_params, captured) => (captured as TextState[]).map(t => t.id),
};

// ── Multi-node ops ───────────────────────────────────────────────────────────

const snapshotIds = (captured: unknown): string[] => (captured as { id: string }[]).map(s => s.id);

/** Multi-node op: snapshot per applicable node via `read`, restore via `write` on undo. */
const nodesSnapshot = (
  tool: string,
  read: (node: SceneNode) => Record<string, unknown> | null,
  write: (node: SceneNode, snap: Record<string, unknown>) => void,
  opts: { resizes?: boolean } = {},
): BatchInverse => {
  return {
    async capture(figmaCtx, params) {
      const nodeIds = stringsParam(params, 'nodeIds', tool);
      const nodes = await Promise.all(nodeIds.map(async id => figmaCtx.getNodeByIdAsync(id)));
      const snaps: { id: string; snap: Record<string, unknown> }[] = [];
      nodes.forEach((node, i) => {
        if (node === null) return;
        const snap = read(node as SceneNode);
        if (snap !== null) snaps.push({ id: nodeIds[i]!, snap });
      });
      return snaps;
    },
    async undo(figmaCtx, _params, captured) {
      const snaps = captured as { id: string; snap: Record<string, unknown> }[];
      const nodes = await Promise.all(snaps.map(async s => live(figmaCtx, s.id)));
      nodes.forEach((node, i) => {
        if (node !== null) write(node as SceneNode, snaps[i]!.snap);
      });
      return undefined;
    },
    touches: (_params, captured) => snapshotIds(captured),
    ...(opts.resizes === true && {
      resizes: (_params: unknown, captured: unknown) => snapshotIds(captured),
    }),
  };
};

interface ResizeState {
  geometry: GeometrySnapshot;
  bindings: BindingSnapshot;
}

/**
 * Resize_nodes: `resize()` flips HUG/FILL to FIXED and pushes constrained children. Put the box
 * back through the geometry snapshot (which never re-applies constraints), re-bind width/height;
 * the layout guard puts back whatever the constraints pushed.
 */
const resizeNodesInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    const nodeIds = stringsParam(params, 'nodeIds', 'resize_nodes');
    const nodes = await Promise.all(nodeIds.map(async id => figmaCtx.getNodeByIdAsync(id)));
    const resizable = nodes.filter(
      (node): node is SceneNode =>
        node !== null && typeof (node as { resize?: unknown }).resize === 'function',
    );
    return Promise.all(
      resizable.map(async (node): Promise<ResizeState> => ({
        geometry: captureGeometry(node),
        bindings: await captureBindings(figmaCtx, node, ['width', 'height']),
      })),
    );
  },
  async undo(figmaCtx, _params, captured) {
    /* eslint-disable no-await-in-loop -- re-binding resolves variables one node at a time */
    for (const { geometry, bindings } of captured as ResizeState[]) {
      const node = await live(figmaCtx, geometry.id);
      if (node === null) continue;
      unbindAdded(node, bindings);
      restoreGeometry(node as SceneNode, geometry);
      rebind(node, bindings);
    }
    /* eslint-enable no-await-in-loop */
    return undefined;
  },
  touches: (_params, captured) => (captured as ResizeState[]).map(s => s.geometry.id),
  resizes: (_params, captured) => (captured as ResizeState[]).map(s => s.geometry.id),
};

/** Batch_rename_nodes: the names of the nodes it will rename (the handler's own filter). */
const batchRenameInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    const renames = paramsOf(params).renames;
    if (!Array.isArray(renames)) {
      throw new TypeError('batch/batch_rename_nodes: renames must be an array');
    }
    const ids = (renames as { nodeId?: unknown; name?: unknown }[])
      .filter(r => typeof r?.nodeId === 'string' && typeof r.name === 'string')
      .map(r => r.nodeId as string);
    const nodes = await Promise.all(ids.map(async id => figmaCtx.getNodeByIdAsync(id)));
    return nodes.flatMap(n => (n === null ? [] : [{ id: n.id, name: n.name }]));
  },
  async undo(figmaCtx, _params, captured) {
    const snaps = captured as { id: string; name: string }[];
    const nodes = await Promise.all(snaps.map(async s => live(figmaCtx, s.id)));
    nodes.forEach((node, i) => {
      if (node !== null) writeIfDifferent(node, 'name', snaps[i]!.name);
    });
    return undefined;
  },
  touches: (_params, captured) => (captured as { id: string }[]).map(s => s.id),
};

// ── Tree structure ───────────────────────────────────────────────────────────

interface Rehome {
  placements: Placement[];
  orders: { parentId: string; order: string[] }[];
}

/**
 * Snapshot every moved node's placement and the child order of every container involved — each
 * node's current parent, then `also` (the destination) — so undo can rebuild each container.
 */
const captureRehome = (
  nodes: readonly SceneNode[],
  also: readonly (BaseNode & ChildrenMixin)[],
): Rehome => {
  const containers = new Map<string, BaseNode & ChildrenMixin>();
  for (const n of nodes) {
    if (n.parent !== null) containers.set(n.parent.id, n.parent as BaseNode & ChildrenMixin);
  }
  for (const c of also) containers.set(c.id, c);
  return {
    placements: nodes.map(capturePlacement),
    orders: [...containers.values()].map(c => ({ parentId: c.id, order: captureOrder(c) })),
  };
};

/**
 * Put every moved node back: rebuild each container's order (which re-inserts a node into the
 * container it left), then each node's box and name — leaving a container resets both (leaving
 * auto-layout drops the position; leaving a variant set renames the component).
 */
const undoRehome = async (figmaCtx: typeof figma, rehome: Rehome): Promise<void> => {
  /* eslint-disable no-await-in-loop -- containers are rebuilt one after another */
  for (const { parentId, order } of rehome.orders) await restoreOrder(figmaCtx, parentId, order);
  /* eslint-enable no-await-in-loop */
  const nodes = await Promise.all(rehome.placements.map(async p => live(figmaCtx, p.geometry.id)));
  rehome.placements.forEach((p, i) => {
    const node = nodes[i];
    if (node === null || node === undefined) {
      throw new Error(`node ${p.geometry.id} no longer exists to be put back`);
    }
    restoreGeometry(node as SceneNode, p.geometry);
    writeIfDifferent(node, 'name', p.name);
  });
};

/**
 * A variant leaving its set is renamed and changes the set's variant properties; the rename was
 * measured to be undoable, the rest was not, so it is refused rather than guessed at.
 */
const refuseVariantLeaving = (
  tool: string,
  nodes: readonly SceneNode[],
  destinationId: string | null,
): void => {
  for (const n of nodes) {
    if (n.parent?.type === 'COMPONENT_SET' && n.parent.id !== destinationId) {
      throw new Error(
        `batch/${tool}: ${n.id} is a variant of ${n.parent.id} — taking it out of its set rewrites ` +
          'its name and the variant properties of the set, which has no faithful inverse',
      );
    }
  }
};

const parentIds = (rehome: Rehome): string[] => rehome.orders.map(o => o.parentId);

interface ReparentState {
  rehome: Rehome;
}

const reparentInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    const destinationId = stringParam(params, 'newParentId', 'reparent_nodes');
    const destination = await nodeOf(figmaCtx, destinationId, 'reparent_nodes');
    if (!('appendChild' in destination)) {
      throw new Error(`batch/reparent_nodes: ${destinationId} cannot contain children`);
    }
    const ids = stringsParam(params, 'nodeIds', 'reparent_nodes');
    const nodes = (await Promise.all(ids.map(async id => figmaCtx.getNodeByIdAsync(id)))).filter(
      (n): n is SceneNode => n !== null && 'parent' in n && n.parent !== null,
    );
    refuseVariantLeaving('reparent_nodes', nodes, destinationId);
    const state: ReparentState = {
      rehome: captureRehome(nodes, [destination as BaseNode & ChildrenMixin]),
    };
    return state;
  },
  async undo(figmaCtx, _params, captured) {
    await undoRehome(figmaCtx, (captured as ReparentState).rehome);
    return undefined;
  },
  resizes: (_params, captured) => {
    const { rehome } = captured as ReparentState;
    return [...parentIds(rehome), ...rehome.placements.map(p => p.geometry.id)];
  },
  moves: async (_figmaCtx, params) => ({
    nodeIds: stringsParam(params, 'nodeIds', 'reparent_nodes'),
    destinationId: stringParam(params, 'newParentId', 'reparent_nodes'),
  }),
};

/** The nodes group_nodes will group — the handler's own filter — and the parent it groups under. */
const groupTargets = async (
  figmaCtx: typeof figma,
  params: unknown,
): Promise<{ nodes: SceneNode[]; parent: BaseNode & ChildrenMixin }> => {
  const ids = stringsParam(params, 'nodeIds', 'group_nodes');
  const nodes = (await Promise.all(ids.map(async id => figmaCtx.getNodeByIdAsync(id)))).filter(
    (n): n is SceneNode => n !== null && 'parent' in n,
  );
  const parent = nodes[0]?.parent;
  if (parent === null || parent === undefined || !('appendChild' in parent)) {
    throw new Error('batch/group_nodes: no valid nodes to group, or no groupable parent');
  }
  return { nodes, parent: parent as BaseNode & ChildrenMixin };
};

/** Ungroup by putting every node back where it was; Figma deletes the group once it is empty. */
const removeLeftover = async (figmaCtx: typeof figma, result: unknown): Promise<void> => {
  const id = (result as { nodeId?: unknown } | null)?.nodeId;
  if (typeof id !== 'string') return;
  const node = await live(figmaCtx, id);
  if (node !== null && 'children' in node && (node as ChildrenMixin).children.length === 0) {
    node.remove();
  }
};

const groupInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    const { nodes, parent } = await groupTargets(figmaCtx, params);
    refuseVariantLeaving('group_nodes', nodes, parent.id);
    const state: ReparentState = { rehome: captureRehome(nodes, [parent]) };
    return state;
  },
  async undo(figmaCtx, _params, captured, result) {
    await undoRehome(figmaCtx, (captured as ReparentState).rehome);
    await removeLeftover(figmaCtx, result);
    return undefined;
  },
  resizes: (_params, captured) => parentIds((captured as ReparentState).rehome),
  moves: async (figmaCtx, params) => {
    const { nodes, parent } = await groupTargets(figmaCtx, params);
    return { nodeIds: nodes.map(n => n.id), destinationId: parent.id };
  },
};

interface CombineState extends ReparentState {
  /** Each component's own property ids before it joined the set. */
  properties: { id: string; keys: string[] }[];
}

/**
 * Combine_as_variants. Taking the components back out of the set restores their names and their own
 * property ids (measured), but hands every component a copy of the set's shared properties — one
 * that never had a property comes back with its sibling's (measured). Those extras go.
 */
const combineInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    const ids = stringsParam(params, 'nodeIds', 'combine_as_variants');
    const nodes = await Promise.all(
      ids.map(async id => nodeOf(figmaCtx, id, 'combine_as_variants')),
    );
    for (const n of nodes) {
      if (n.type !== 'COMPONENT') {
        throw new Error(`batch/combine_as_variants: node ${n.id} is a ${n.type}, not a COMPONENT`);
      }
    }
    const components = nodes as ComponentNode[];
    refuseVariantLeaving('combine_as_variants', components, null);
    const parentId = paramsOf(params).parentId;
    const also =
      typeof parentId === 'string'
        ? [(await nodeOf(figmaCtx, parentId, 'combine_as_variants')) as BaseNode & ChildrenMixin]
        : [];
    const state: CombineState = {
      rehome: captureRehome(components, also),
      properties: components.map(c => ({
        id: c.id,
        keys: Object.keys(c.componentPropertyDefinitions),
      })),
    };
    return state;
  },
  async undo(figmaCtx, _params, captured, result) {
    const s = captured as CombineState;
    await undoRehome(figmaCtx, s.rehome);
    await removeLeftover(figmaCtx, result);
    const components = await Promise.all(s.properties.map(async p => live(figmaCtx, p.id)));
    s.properties.forEach((p, i) => {
      const component = components[i] as ComponentNode | null | undefined;
      if (component === null || component === undefined) return;
      for (const key of Object.keys(component.componentPropertyDefinitions)) {
        if (!p.keys.includes(key)) component.deleteComponentProperty(key);
      }
    });
    return undefined;
  },
  resizes: (_params, captured) => parentIds((captured as CombineState).rehome),
  moves: async (_figmaCtx, params) => ({
    nodeIds: stringsParam(params, 'nodeIds', 'combine_as_variants'),
    destinationId: null,
  }),
};

interface OrderState {
  ids: string[];
  orders: { parentId: string; order: string[] }[];
}

const reorderInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    const ids = stringsParam(params, 'nodeIds', 'reorder_nodes');
    const nodes = await Promise.all(ids.map(async id => figmaCtx.getNodeByIdAsync(id)));
    const parents = new Map<string, BaseNode & ChildrenMixin>();
    for (const n of nodes) {
      const parent = n !== null && 'parent' in n ? n.parent : null;
      if (parent !== null && 'insertChild' in parent) {
        parents.set(parent.id, parent as BaseNode & ChildrenMixin);
      }
    }
    const state: OrderState = {
      ids,
      orders: [...parents.values()].map(p => ({ parentId: p.id, order: captureOrder(p) })),
    };
    return state;
  },
  async undo(figmaCtx, _params, captured) {
    /* eslint-disable no-await-in-loop -- containers are rebuilt one after another */
    for (const { parentId, order } of (captured as OrderState).orders) {
      await restoreOrder(figmaCtx, parentId, order);
    }
    /* eslint-enable no-await-in-loop */
    return undefined;
  },
  touches: (_params, captured) => (captured as OrderState).ids,
};

// ── Layout ───────────────────────────────────────────────────────────────────

/**
 * What set_auto_layout can write, in restore order: counts before the track arrays they size, wrap
 * before the wrap-only cross-axis fields. Grid tracks go back as whole arrays — measured: shrinking
 * the column count and growing it back turns a FIXED track FLEX, and assigning the array restores
 * it.
 */
const AUTO_LAYOUT_PROPS = [
  'layoutWrap',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'itemSpacing',
  'counterAxisSpacing',
  'primaryAxisAlignItems',
  'counterAxisAlignItems',
  'counterAxisAlignContent',
  'itemReverseZIndex',
  'strokesIncludedInLayout',
];
const GRID_PROPS = [
  'gridRowCount',
  'gridColumnCount',
  'gridRowSizes',
  'gridColumnSizes',
  'gridRowGap',
  'gridColumnGap',
];
const AUTO_LAYOUT_BINDINGS = [
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'itemSpacing',
  'counterAxisSpacing',
  'gridRowGap',
  'gridColumnGap',
];

interface AutoLayoutState {
  id: string;
  mode: string;
  values: Bag;
  grid: Bag;
  bindings: BindingSnapshot;
  frame: GeometrySnapshot;
  children: GeometrySnapshot[];
}

/**
 * Set_auto_layout. Turning auto-layout on re-sizes the frame (an axis goes HUG) and re-places every
 * child; turning it off leaves both where the layout put them. So besides the frame's own layout
 * fields, snapshot its box and every child's.
 */
const autoLayoutInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    const id = stringParam(params, 'nodeId', 'set_auto_layout');
    const node = await nodeOf(figmaCtx, id, 'set_auto_layout');
    if (!('layoutMode' in node)) {
      throw new Error(`batch/set_auto_layout: node ${id} has no auto layout`);
    }
    const frame = node as FrameNode;
    const bag = frame as unknown as Bag;
    const values: Bag = {};
    for (const k of AUTO_LAYOUT_PROPS) if (k in frame) values[k] = bag[k];
    const grid: Bag = {};
    if (frame.layoutMode === 'GRID') {
      // Track sizes are live objects with setters; keep plain copies.
      for (const k of GRID_PROPS) grid[k] = toPlainJson(bag[k]);
    }
    const state: AutoLayoutState = {
      id,
      mode: frame.layoutMode,
      values,
      grid,
      bindings: await captureBindings(figmaCtx, frame, AUTO_LAYOUT_BINDINGS),
      frame: captureGeometry(frame),
      children: frame.children.map(captureGeometry),
    };
    return state;
  },
  async undo(figmaCtx, _params, captured) {
    const s = captured as AutoLayoutState;
    const node = await live(figmaCtx, s.id);
    if (node === null) return undefined;
    const frame = node as FrameNode;
    unbindAdded(frame, s.bindings);
    // A layout field is only writable while the frame is in a mode that has it: back into a mode
    // that uses them, set the mode first; back to NONE, write them while the mode still allows it.
    if (s.mode !== 'NONE') writeIfDifferent(frame, 'layoutMode', s.mode);
    for (const [k, v] of Object.entries(s.values)) writeIfDifferent(frame, k, v);
    for (const [k, v] of Object.entries(s.grid)) writeIfDifferent(frame, k, v);
    if (s.mode === 'NONE') writeIfDifferent(frame, 'layoutMode', 'NONE');
    restoreGeometry(frame, s.frame);
    const children = await Promise.all(s.children.map(async c => live(figmaCtx, c.id)));
    children.forEach((child, i) => {
      if (child !== null) restoreGeometry(child as SceneNode, s.children[i]!);
    });
    rebind(frame, s.bindings);
    return undefined;
  },
  touches: (_params, captured) => [(captured as AutoLayoutState).id],
  resizes: (_params, captured) => [(captured as AutoLayoutState).id],
};

interface GeometryState {
  id: string;
  geometry: GeometrySnapshot;
  bindings: BindingSnapshot;
}

/** Set_layout_props writes sizing, grow/align, positioning and min/max — the box, whole. */
const layoutPropsInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    const id = stringParam(params, 'nodeId', 'set_layout_props');
    const node = await nodeOf(figmaCtx, id, 'set_layout_props');
    if (!('layoutAlign' in node)) {
      throw new Error(`batch/set_layout_props: node ${id} has no auto-layout child properties`);
    }
    const state: GeometryState = {
      id,
      geometry: captureGeometry(node as SceneNode),
      bindings: await captureBindings(figmaCtx, node, [
        'minWidth',
        'maxWidth',
        'minHeight',
        'maxHeight',
        'width',
        'height',
      ]),
    };
    return state;
  },
  async undo(figmaCtx, _params, captured) {
    const { id, geometry, bindings } = captured as GeometryState;
    const node = await live(figmaCtx, id);
    if (node === null) return undefined;
    unbindAdded(node, bindings);
    restoreGeometry(node as SceneNode, geometry);
    rebind(node, bindings);
    return undefined;
  },
  touches: (_params, captured) => [(captured as GeometryState).id],
  resizes: (_params, captured) => [(captured as GeometryState).id],
};

// ── Styles and bindings on nodes ─────────────────────────────────────────────

const STYLE_FIELD_PROP: Readonly<Record<string, string>> = {
  fill: 'fills',
  stroke: 'strokes',
  effect: 'effects',
  grid: 'layoutGrids',
};

interface MixedState {
  id: string;
  props: PropsSnapshot | null;
  text: TextSnapshot | null;
  geometry: GeometrySnapshot | null;
  bindings: BindingSnapshot;
}

const restoreMixed = async (figmaCtx: typeof figma, s: MixedState): Promise<unknown> => {
  const node = await live(figmaCtx, s.id);
  if (node === null) return undefined;
  unbindAdded(node, s.bindings);
  if (s.props !== null) await restoreProps(node, s.props);
  if (s.geometry !== null) restoreGeometry(node as SceneNode, s.geometry);
  const note = s.text === null ? undefined : await restoreText(figmaCtx, node as TextNode, s.text);
  rebind(node, s.bindings);
  return note;
};

const mixedTouches = (_params: unknown, captured: unknown): string[] => [
  (captured as MixedState).id,
];

/**
 * Apply_style_to_node: applying a style overwrites the value it styles; the value and the prior
 * style link (none, or another style) both go back. A text style styles the runs.
 */
const applyStyleInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    const id = stringParam(params, 'nodeId', 'apply_style_to_node');
    const field = stringParam(params, 'field', 'apply_style_to_node');
    const node = await nodeOf(figmaCtx, id, 'apply_style_to_node');
    if (field === 'text') {
      if (node.type !== 'TEXT') {
        throw new Error(`batch/apply_style_to_node: node ${id} cannot take a text style`);
      }
      const state: MixedState = {
        id,
        props: null,
        text: await captureText(figmaCtx, node),
        geometry: null,
        bindings: {},
      };
      return state;
    }
    const prop = STYLE_FIELD_PROP[field];
    if (prop === undefined || !(prop in node)) {
      throw new Error(`batch/apply_style_to_node: node ${id} cannot take a ${field} style`);
    }
    const state: MixedState = {
      id,
      props: await captureProps(figmaCtx, node, [prop]),
      text: node.type === 'TEXT' && prop === 'fills' ? await captureText(figmaCtx, node) : null,
      geometry: null,
      bindings: {},
    };
    return state;
  },
  undo: async (figmaCtx, _params, captured) => restoreMixed(figmaCtx, captured as MixedState),
  touches: mixedTouches,
  resizes: mixedTouches,
};

/** Text fields a node-level binding reaches into every run of. */
const TEXT_BINDABLE = new Set([
  'characters',
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'paragraphSpacing',
  'paragraphIndent',
]);

/**
 * Bind_variable_to_node: binding replaces the field's value with the variable's (and a width or
 * height binding turns HUG to FIXED, measured); unbinding keeps the resolved value. Snapshot the
 * binding and the value, by what the field is.
 */
const bindToNodeInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    const id = stringParam(params, 'nodeId', 'bind_variable_to_node');
    const field = stringParam(params, 'field', 'bind_variable_to_node');
    const node = await nodeOf(figmaCtx, id, 'bind_variable_to_node');
    const text = node.type === 'TEXT' && TEXT_BINDABLE.has(field);
    const box = !text && (field === 'width' || field === 'height');
    const state: MixedState = {
      id,
      props: !text && !box && field in node ? await captureProps(figmaCtx, node, [field]) : null,
      text: text ? await captureText(figmaCtx, node) : null,
      geometry: box ? captureGeometry(node as SceneNode) : null,
      bindings: await captureBindings(figmaCtx, node, [field]),
    };
    return state;
  },
  undo: async (figmaCtx, _params, captured) => restoreMixed(figmaCtx, captured as MixedState),
  touches: mixedTouches,
  resizes: mixedTouches,
};

/** Bind_variable_to_paint writes the whole fills/strokes array back (detaching its style). */
const bindToPaintInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    const id = stringParam(params, 'nodeId', 'bind_variable_to_paint');
    const target = paramsOf(params).target === 'strokes' ? 'strokes' : 'fills';
    const node = await nodeOf(figmaCtx, id, 'bind_variable_to_paint');
    if (!(target in node))
      throw new Error(`batch/bind_variable_to_paint: node ${id} has no ${target}`);
    const state: MixedState = {
      id,
      props: await captureProps(figmaCtx, node, [target]),
      text: node.type === 'TEXT' && target === 'fills' ? await captureText(figmaCtx, node) : null,
      geometry: null,
      bindings: {},
    };
    return state;
  },
  undo: async (figmaCtx, _params, captured) => restoreMixed(figmaCtx, captured as MixedState),
  touches: mixedTouches,
};

// ── Instances ────────────────────────────────────────────────────────────────

type PropertyValue = string | boolean | VariableAlias;

const instanceOf = async (
  figmaCtx: typeof figma,
  params: unknown,
  tool: string,
): Promise<InstanceNode> => {
  const id = stringParam(params, 'instanceId', tool);
  const node = await nodeOf(figmaCtx, id, tool);
  if (node.type !== 'INSTANCE') throw new Error(`batch/${tool}: node ${id} is not an INSTANCE`);
  return node;
};

const swapBack = async (
  figmaCtx: typeof figma,
  instance: InstanceNode,
  mainId: string,
): Promise<void> => {
  const main = await instance.getMainComponentAsync();
  if (main?.id === mainId) return;
  const component = await figmaCtx.getNodeByIdAsync(mainId);
  if (component?.type !== 'COMPONENT') throw new Error(`component ${mainId} no longer exists`);
  instance.swapComponent(component);
};

interface InstanceState {
  id: string;
  mainId: string;
  properties: Record<string, PropertyValue>;
}

/**
 * Set_instance_properties: put the touched properties back (a bound one as its alias — measured to
 * round-trip). A VARIANT property swaps the main component; setting it back swaps back, and the
 * main is checked after in case it did not.
 */
const instancePropsInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    const instance = await instanceOf(figmaCtx, params, 'set_instance_properties');
    const properties = paramsOf(params).properties;
    const keys =
      typeof properties === 'object' && properties !== null ? Object.keys(properties) : [];
    const current = instance.componentProperties;
    const previous: Record<string, PropertyValue> = {};
    for (const key of keys) {
      const prop = current[key];
      if (prop !== undefined) previous[key] = prop.boundVariables?.value ?? prop.value;
    }
    const main = await instance.getMainComponentAsync();
    if (main === null) {
      throw new Error(
        `batch/set_instance_properties: ${instance.id} has no main component to return to`,
      );
    }
    const state: InstanceState = { id: instance.id, mainId: main.id, properties: previous };
    return state;
  },
  async undo(figmaCtx, _params, captured) {
    const s = captured as InstanceState;
    const node = await live(figmaCtx, s.id);
    if (node?.type !== 'INSTANCE') return undefined;
    const now = node.componentProperties;
    const changed = Object.fromEntries(
      Object.entries(s.properties).filter(
        ([key, value]) => !same(now[key]?.boundVariables?.value ?? now[key]?.value, value),
      ),
    );
    if (Object.keys(changed).length > 0) node.setProperties(changed);
    await swapBack(figmaCtx, node, s.mainId);
    return undefined;
  },
  touches: (_params, captured) => [(captured as InstanceState).id],
  resizes: (_params, captured) => [(captured as InstanceState).id],
};

/** Swap_component: swap back to the main it had (overrides survive a round trip, measured). */
const swapInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    const instance = await instanceOf(figmaCtx, params, 'swap_component');
    const main = await instance.getMainComponentAsync();
    if (main === null) {
      throw new Error(`batch/swap_component: ${instance.id} has no main component to swap back to`);
    }
    const state: InstanceState = { id: instance.id, mainId: main.id, properties: {} };
    return state;
  },
  async undo(figmaCtx, _params, captured) {
    const s = captured as InstanceState;
    const node = await live(figmaCtx, s.id);
    if (node?.type === 'INSTANCE') await swapBack(figmaCtx, node, s.mainId);
    return undefined;
  },
  touches: (_params, captured) => [(captured as InstanceState).id],
  resizes: (_params, captured) => [(captured as InstanceState).id],
};

// ── Creates ──────────────────────────────────────────────────────────────────

/** Create op: validate parentId (if any) up front; undo removes the node the op created. */
const createInverse = (tool: string, hasParent = true): BatchInverse => ({
  async capture(figmaCtx, params) {
    if (!hasParent) return null;
    const parentId = paramsOf(params).parentId;
    if (typeof parentId !== 'string') return null;
    const parent = await figmaCtx.getNodeByIdAsync(parentId);
    if (parent === null || !('appendChild' in parent)) {
      throw new Error(`batch/${tool}: parent ${parentId} not found or cannot contain children`);
    }
    return null;
  },
  async undo(figmaCtx, _params, _captured, result) {
    const id = (result as { nodeId?: unknown } | null)?.nodeId;
    if (typeof id !== 'string') return undefined;
    const node = await figmaCtx.getNodeByIdAsync(id);
    if (node !== null && 'remove' in node) (node as { remove(): void }).remove();
    return undefined;
  },
  // A child added to a HUG parent grows it — and pushes whatever the parent constrains.
  ...(hasParent && {
    resizes: (params: unknown) => {
      const parentId = paramsOf(params).parentId;
      return typeof parentId === 'string' ? [parentId] : [];
    },
  }),
});

/**
 * Create_component is invertible as an empty create (undo removes the new node), but `fromNodeId`
 * componentizes — and consumes — an existing node, which has no faithful inverse (removing the
 * component would destroy the original). Reject that variant up front, like other non-invertible
 * ops.
 */
const componentCreateInverse = createInverse('create_component');
const createComponentInverse: BatchInverse = {
  ...componentCreateInverse,
  async capture(figmaCtx, params) {
    if (typeof paramsOf(params).fromNodeId === 'string') {
      throw new Error(
        'batch/create_component: fromNodeId is not batchable — componentizing a node consumes it and has no faithful inverse',
      );
    }
    return componentCreateInverse.capture(figmaCtx, params);
  },
};

/** A create whose result names what it made by `key`; undo deletes that thing via `remove`. */
const createdInverse = (
  key: string,
  remove: (figmaCtx: typeof figma, id: string, params: unknown) => Promise<void>,
): BatchInverse => ({
  capture: async () => null,
  async undo(figmaCtx, params, _captured, result) {
    const id = (result as Bag | null)?.[key];
    if (typeof id === 'string') await remove(figmaCtx, id, params);
    return undefined;
  },
});

const removeStyle = async (figmaCtx: typeof figma, id: string): Promise<void> => {
  (await figmaCtx.getStyleByIdAsync(id))?.remove();
};

// ── Styles ───────────────────────────────────────────────────────────────────

interface StyleState {
  id: string;
  values: Bag;
}

/**
 * Update_paint_style / update_effect_style: name, description and the value array (bindings ride on
 * its items, measured to round-trip). A style has no `descriptionMarkdown` at runtime, despite the
 * typings — measured — so `description` is the whole of it.
 */
const styleInverse = (tool: string, type: StyleType, valueProp: string): BatchInverse => ({
  async capture(figmaCtx, params) {
    const id = stringParam(params, 'styleId', tool);
    const style = await figmaCtx.getStyleByIdAsync(id);
    if (style?.type !== type)
      throw new Error(`batch/${tool}: ${type.toLowerCase()} style ${id} not found`);
    const bag = style as unknown as Bag;
    const state: StyleState = {
      id,
      values: { name: style.name, description: style.description, [valueProp]: bag[valueProp] },
    };
    return state;
  },
  async undo(figmaCtx, _params, captured) {
    const { id, values } = captured as StyleState;
    const style = await figmaCtx.getStyleByIdAsync(id);
    if (style !== null) for (const [k, v] of Object.entries(values)) writeIfDifferent(style, k, v);
    return undefined;
  },
});

/** Everything update_text_style (or a binding it applies) can change on a text style. */
const TEXT_STYLE_PROPS = [
  'name',
  'description',
  'fontName',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'paragraphSpacing',
  'paragraphIndent',
  'textWrapStyle',
];
const TEXT_STYLE_BINDABLE: readonly VariableBindableTextField[] = [
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'paragraphSpacing',
  'paragraphIndent',
];

interface TextStyleState extends StyleState {
  bindings: Record<string, string | null>;
  consumers: string[];
}

const textStyleBinding = (style: TextStyle, field: VariableBindableTextField): string | null =>
  style.boundVariables?.[field]?.id ?? null;

/**
 * Update_text_style: unbind what the op bound, put the raw typography back (fonts loaded — measured
 * to be required even for a size-only write), then re-bind what it unbound. Its consumers re-lay
 * out, so their layout regions are guarded.
 */
const textStyleInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    const id = stringParam(params, 'styleId', 'update_text_style');
    const style = await figmaCtx.getStyleByIdAsync(id);
    if (style?.type !== 'TEXT')
      throw new Error(`batch/update_text_style: text style ${id} not found`);
    const text = style as TextStyle;
    const bag = text as unknown as Bag;
    const values: Bag = {};
    for (const k of TEXT_STYLE_PROPS) values[k] = bag[k];
    const bindings: Record<string, string | null> = {};
    for (const f of TEXT_STYLE_BINDABLE) bindings[f] = textStyleBinding(text, f);
    const consumers = (await text.getStyleConsumersAsync()).map(c => c.node.id);
    const state: TextStyleState = { id, values, bindings, consumers };
    return state;
  },
  async undo(figmaCtx, _params, captured) {
    const s = captured as TextStyleState;
    const style = (await figmaCtx.getStyleByIdAsync(s.id)) as TextStyle | null;
    if (style === null) return undefined;
    await loadFonts(figmaCtx, [s.values.fontName as FontName, style.fontName]);
    for (const f of TEXT_STYLE_BINDABLE) {
      if (s.bindings[f] === null && textStyleBinding(style, f) !== null)
        style.setBoundVariable(f, null);
    }
    for (const [k, v] of Object.entries(s.values)) writeIfDifferent(style, k, v);
    /* eslint-disable no-await-in-loop -- a style has at most eight bindable fields */
    for (const f of TEXT_STYLE_BINDABLE) {
      const id = s.bindings[f];
      if (id === null || id === undefined || textStyleBinding(style, f) === id) continue;
      const variable = await figmaCtx.variables.getVariableByIdAsync(id);
      if (variable === null) throw new Error(`variable ${id} bound to ${f} no longer exists`);
      style.setBoundVariable(f, variable);
    }
    /* eslint-enable no-await-in-loop */
    return undefined;
  },
  resizes: (_params, captured) => (captured as TextStyleState).consumers,
};

// ── Variables ────────────────────────────────────────────────────────────────

interface VariableValueState {
  id: string;
  modeId: string;
  previous: VariableValue;
}

/**
 * Set_variable_value on a mode of the variable's own collection. A mode of an extended collection
 * writes an override, whose inverse (removeOverrideForMode) needs an Enterprise file to verify —
 * refused until it has been.
 */
const variableValueInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    const id = stringParam(params, 'variableId', 'set_variable_value');
    const modeId = stringParam(params, 'modeId', 'set_variable_value');
    const variable = await figmaCtx.variables.getVariableByIdAsync(id);
    if (variable === null) throw new Error(`batch/set_variable_value: variable ${id} not found`);
    const collection = await figmaCtx.variables.getVariableCollectionByIdAsync(
      variable.variableCollectionId,
    );
    const previous = variable.valuesByMode[modeId];
    if (
      collection === null ||
      !collection.modes.some(m => m.modeId === modeId) ||
      previous === undefined
    ) {
      throw new Error(
        `batch/set_variable_value: mode ${modeId} is not a mode of ${variable.name}'s own collection — ` +
          'a value written through an extended collection is an override with no verified inverse',
      );
    }
    const state: VariableValueState = {
      id,
      modeId,
      previous: toPlainJson(previous) as VariableValue,
    };
    return state;
  },
  async undo(figmaCtx, _params, captured) {
    const s = captured as VariableValueState;
    const variable = await figmaCtx.variables.getVariableByIdAsync(s.id);
    if (variable !== null && !same(variable.valuesByMode[s.modeId], s.previous)) {
      variable.setValueForMode(s.modeId, s.previous);
    }
    return undefined;
  },
};

type Platform = 'WEB' | 'ANDROID' | 'iOS';

interface CodeSyntaxState {
  id: string;
  previous: Partial<Record<Platform, string>>;
  platforms: Platform[];
}

const codeSyntaxInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    const id = stringParam(params, 'variableId', 'set_variable_code_syntax');
    const variable = await figmaCtx.variables.getVariableByIdAsync(id);
    if (variable === null)
      throw new Error(`batch/set_variable_code_syntax: variable ${id} not found`);
    const codeSyntax = paramsOf(params).codeSyntax;
    const state: CodeSyntaxState = {
      id,
      previous: { ...variable.codeSyntax },
      platforms: (typeof codeSyntax === 'object' && codeSyntax !== null
        ? Object.keys(codeSyntax)
        : []) as Platform[],
    };
    return state;
  },
  async undo(figmaCtx, _params, captured) {
    const s = captured as CodeSyntaxState;
    const variable = await figmaCtx.variables.getVariableByIdAsync(s.id);
    if (variable === null) return undefined;
    for (const platform of s.platforms) {
      const was = s.previous[platform];
      const now = variable.codeSyntax[platform];
      if (was === now) continue;
      if (was === undefined) variable.removeVariableCodeSyntax(platform);
      else variable.setVariableCodeSyntax(platform, was);
    }
    return undefined;
  },
};

const renameVariableInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    const id = stringParam(params, 'variableId', 'rename_variable');
    const variable = await figmaCtx.variables.getVariableByIdAsync(id);
    if (variable === null) throw new Error(`batch/rename_variable: variable ${id} not found`);
    return { id, name: variable.name };
  },
  async undo(figmaCtx, _params, captured) {
    const { id, name } = captured as { id: string; name: string };
    const variable = await figmaCtx.variables.getVariableByIdAsync(id);
    if (variable !== null && variable.name !== name) variable.name = name;
    return undefined;
  },
};

// ── Component properties ─────────────────────────────────────────────────────

interface EditPropertyState {
  ownerId: string;
  previous: {
    name?: string;
    defaultValue?: PropertyValue;
    preferredValues?: InstanceSwapPreferredValue[];
  };
}

/**
 * Edit_component_property: edit back the fields the op edited. Renaming mints a new id — renaming
 * back restores the original one (measured) — so the undo addresses the property by the id the op
 * returned. A default bound to a variable goes back as its alias.
 */
const editPropertyInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    const componentId = stringParam(params, 'componentId', 'edit_component_property');
    const propertyId = stringParam(params, 'propertyId', 'edit_component_property');
    const node = await nodeOf(figmaCtx, componentId, 'edit_component_property');
    const owner = resolveComponentOwner('batch/edit_component_property', node);
    const def = owner.componentPropertyDefinitions[propertyId];
    if (def === undefined) {
      throw new Error(
        `batch/edit_component_property: property ${propertyId} not found on ${owner.id}`,
      );
    }
    const p = paramsOf(params);
    const previous: EditPropertyState['previous'] = {};
    if (typeof p.name === 'string') previous.name = propertyDisplayName(propertyId);
    if (p.defaultValue !== undefined)
      previous.defaultValue = def.boundVariables?.defaultValue ?? def.defaultValue;
    if (p.preferredValues !== undefined)
      previous.preferredValues = [...(def.preferredValues ?? [])];
    const state: EditPropertyState = { ownerId: owner.id, previous };
    return state;
  },
  async undo(figmaCtx, _params, captured, result) {
    const s = captured as EditPropertyState;
    const propertyId = (result as { propertyId?: unknown } | null)?.propertyId;
    const owner = await live(figmaCtx, s.ownerId);
    if (owner === null || typeof propertyId !== 'string') return undefined;
    (owner as ComponentNode | ComponentSetNode).editComponentProperty(propertyId, s.previous);
    return undefined;
  },
};

const removeProperty = async (
  figmaCtx: typeof figma,
  propertyId: string,
  result: unknown,
): Promise<void> => {
  const ownerId = (result as { componentId?: unknown } | null)?.componentId;
  if (typeof ownerId !== 'string') return;
  const owner = (await live(figmaCtx, ownerId)) as ComponentNode | ComponentSetNode | null;
  if (owner !== null && propertyId in owner.componentPropertyDefinitions) {
    owner.deleteComponentProperty(propertyId);
  }
};

const addPropertyInverse: BatchInverse = {
  capture: async () => null,
  async undo(figmaCtx, _params, _captured, result) {
    const propertyId = (result as { propertyId?: unknown } | null)?.propertyId;
    if (typeof propertyId === 'string') await removeProperty(figmaCtx, propertyId, result);
    return undefined;
  },
};

interface BindPropertyState {
  id: string;
  field: string;
  refs: Record<string, string>;
  visible: boolean | null;
  text: TextSnapshot | null;
  mainId: string | null;
}

type Referencing = SceneNode & { componentPropertyReferences: Record<string, string> | null };

/**
 * Bind_component_property: binding also writes the property's default into the layer (measured:
 * characters and visible both jump to the default) and unbinding leaves it there. So the undo puts
 * the references back, then the layer's own value.
 */
const bindPropertyInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    const id = stringParam(params, 'nodeId', 'bind_component_property');
    const field = stringParam(params, 'field', 'bind_component_property');
    const node = (await nodeOf(figmaCtx, id, 'bind_component_property')) as Referencing;
    const main = node.type === 'INSTANCE' ? await node.getMainComponentAsync() : null;
    const state: BindPropertyState = {
      id,
      field,
      refs: { ...node.componentPropertyReferences },
      visible: field === 'visible' ? node.visible : null,
      text:
        field === 'characters' && node.type === 'TEXT' ? await captureText(figmaCtx, node) : null,
      mainId: field === 'mainComponent' ? (main?.id ?? null) : null,
    };
    return state;
  },
  async undo(figmaCtx, _params, captured) {
    const s = captured as BindPropertyState;
    const node = (await live(figmaCtx, s.id)) as Referencing | null;
    if (node === null) return undefined;
    if (!same(node.componentPropertyReferences ?? {}, s.refs))
      node.componentPropertyReferences = s.refs;
    if (s.visible !== null && node.visible !== s.visible) node.visible = s.visible;
    if (s.mainId !== null && node.type === 'INSTANCE') await swapBack(figmaCtx, node, s.mainId);
    return s.text === null || node.type !== 'TEXT'
      ? undefined
      : restoreText(figmaCtx, node, s.text);
  },
  touches: (_params, captured) => [(captured as BindPropertyState).id],
  resizes: (_params, captured) => [(captured as BindPropertyState).id],
};

// ── Prototype, pages ─────────────────────────────────────────────────────────

/** Set_reactions / remove_reactions: the reactions as read go back as-is (measured to round-trip). */
const reactionsInverse = (tool: string): BatchInverse => ({
  async capture(figmaCtx, params) {
    const id = stringParam(params, 'nodeId', tool);
    const node = await nodeOf(figmaCtx, id, tool);
    if (typeof (node as { setReactionsAsync?: unknown }).setReactionsAsync !== 'function') {
      throw new Error(`batch/${tool}: node ${id} cannot have reactions`);
    }
    return { id, reactions: (node as ReactionMixin).reactions };
  },
  async undo(figmaCtx, _params, captured) {
    const { id, reactions } = captured as { id: string; reactions: readonly Reaction[] };
    const node = (await live(figmaCtx, id)) as (BaseNode & ReactionMixin) | null;
    if (node !== null && !same(node.reactions, reactions))
      await node.setReactionsAsync([...reactions]);
    return undefined;
  },
  touches: (_params, captured) => [(captured as { id: string }).id],
});

/** Navigate_to_page: creates without a parentId land on the current page, so it is batch state. */
const navigateInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    const id = stringParam(params, 'pageId', 'navigate_to_page');
    const page = await nodeOf(figmaCtx, id, 'navigate_to_page');
    if (page.type !== 'PAGE') throw new Error(`batch/navigate_to_page: page ${id} not found`);
    return { previous: figmaCtx.currentPage.id };
  },
  async undo(figmaCtx, _params, captured) {
    const { previous } = captured as { previous: string };
    if (figmaCtx.currentPage.id === previous) return undefined;
    const page = await figmaCtx.getNodeByIdAsync(previous);
    if (page?.type === 'PAGE') await figmaCtx.setCurrentPageAsync(page);
    return undefined;
  },
};

// ── Motion (beta) inverses ───────────────────────────────────────────────────
// Motion authoring joins the batch only where the pre-op state snapshots faithfully — the stagger
// hot-path. apply_animation_style undoes via the appliedStyleId the apply returns; a PROPERTY
// keyframe track round-trips through a deep-cloned snapshot. Indexed
// fills/strokes/effects tracks have no faithful snapshot yet, so they're rejected up front (same
// honesty stance as create_component's fromNodeId) to keep all-or-nothing real. All gate on the
// Figma editor.

const applyAnimationStyleInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    assertFigmaEditor(figmaCtx, 'batch/apply_animation_style');
    const id = stringParam(params, 'nodeId', 'apply_animation_style');
    const node = await figmaCtx.getNodeByIdAsync(id);
    if (node === null || !isMotionNode(node)) {
      throw new Error(
        `batch/apply_animation_style: node ${id} not found or does not support Motion`,
      );
    }
    return { id }; // undo relies on the appliedStyleId in the apply result
  },
  async undo(figmaCtx, _params, _captured, result) {
    const r = result as { nodeId?: unknown; appliedStyleId?: unknown } | null;
    if (typeof r?.nodeId !== 'string' || typeof r.appliedStyleId !== 'string') return undefined;
    const node = await figmaCtx.getNodeByIdAsync(r.nodeId);
    if (node !== null && isMotionNode(node)) node.removeAnimationStyle(r.appliedStyleId);
    return undefined;
  },
  touches: (_params, captured) => [(captured as { id: string }).id],
};

/**
 * Apply_manual_keyframe_track: snapshot the field's prior track; undo removes the applied one, or
 * applies the prior one over it — which keeps the prior track's ids (measured in #78). Applying a
 * track that was REMOVED mints new ids instead, which is why remove_manual_keyframe_track is
 * refused.
 */
const keyframeTrackInverse = (tool: string): BatchInverse => ({
  async capture(figmaCtx, params) {
    assertFigmaEditor(figmaCtx, `batch/${tool}`);
    const p = paramsOf(params);
    const id = stringParam(params, 'nodeId', tool);
    assertKeyframeField(p.field, `batch/${tool}`);
    const field = p.field as { type?: unknown; name?: unknown };
    if (field.type !== 'PROPERTY' || typeof field.name !== 'string') {
      throw new Error(
        `batch/${tool}: only PROPERTY fields are batchable — indexed fills/strokes/effects tracks have no faithful snapshot`,
      );
    }
    const node = await figmaCtx.getNodeByIdAsync(id);
    if (node === null || !isMotionNode(node)) {
      throw new Error(`batch/${tool}: node ${id} not found or does not support Motion`);
    }
    const tracks = node.manualKeyframeTracks as Record<string, unknown>;
    const previous = tracks[field.name];
    // Deep-clone so the snapshot can't be mutated by the apply that follows.
    return { id, field: p.field, previous: previous === undefined ? null : toPlainJson(previous) };
  },
  async undo(figmaCtx, _params, captured) {
    const { id, field, previous } = captured as {
      id: string;
      field: KeyframeField;
      previous: ManualKeyframeTrackInput | null;
    };
    const node = await figmaCtx.getNodeByIdAsync(id);
    if (node === null || !isMotionNode(node)) return undefined;
    const now = (node.manualKeyframeTracks as Record<string, unknown>)[
      (field as { name: string }).name
    ];
    if (previous === null) {
      if (now !== undefined) node.removeManualKeyframeTrack(field);
    } else if (now === undefined || !same(toPlainJson(now), previous)) {
      node.applyManualKeyframeTrack(field, previous);
    }
    return undefined;
  },
  touches: (_params, captured) => [(captured as { id: string }).id],
});

const setTimelineDurationInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    assertFigmaEditor(figmaCtx, 'batch/set_timeline_duration');
    const id = stringParam(params, 'nodeId', 'set_timeline_duration');
    const timelineId = stringParam(params, 'timelineId', 'set_timeline_duration');
    const node = await figmaCtx.getNodeByIdAsync(id);
    if (node === null || !isMotionNode(node)) {
      throw new Error(
        `batch/set_timeline_duration: node ${id} not found or does not support Motion`,
      );
    }
    const timeline = node.timelines.find(t => t.id === timelineId);
    if (timeline === undefined) {
      throw new Error(
        `batch/set_timeline_duration: timeline ${timelineId} not found on node ${id}`,
      );
    }
    return { id, timelineId, duration: timeline.duration };
  },
  async undo(figmaCtx, _params, captured) {
    const { id, timelineId, duration } = captured as {
      id: string;
      timelineId: string;
      duration: number;
    };
    const node = await figmaCtx.getNodeByIdAsync(id);
    if (node === null || !isMotionNode(node)) return undefined;
    node.setTimelineDuration(timelineId, duration);
    return undefined;
  },
};

/** Tool name → inverse. Membership here is the allowlist: only these ops may appear in a batch. */
const INVERSES: Readonly<Record<string, BatchInverse>> = {
  // Single-node properties. Snapshot every field the handler can write, not just the headline one,
  // plus the bindings a write drops. Order matters where a uniform value precedes per-side/corner
  // values it would otherwise overwrite (mirrors the handlers).
  set_fills: propsInverse('set_fills', ['fills']),
  set_strokes: propsInverse(
    'set_strokes',
    [
      'strokes',
      ...STROKE_WEIGHTS.slice(0, 1),
      'strokeAlign',
      'dashPattern',
      ...STROKE_WEIGHTS.slice(1),
    ],
    { bindings: STROKE_WEIGHTS, resizes: true },
  ),
  set_opacity: propsInverse('set_opacity', ['opacity']),
  set_visible: propsInverse('set_visible', ['visible'], { resizes: true }),
  set_corner_radius: propsInverse('set_corner_radius', CORNERS),
  set_arc: propsInverse('set_arc', ['arcData']),
  set_blend_mode: propsInverse('set_blend_mode', ['blendMode']),
  set_effects: propsInverse('set_effects', ['effects']),
  set_constraints: propsInverse('set_constraints', ['constraints']),
  set_position: propsInverse('set_position', ['x', 'y']),
  set_mask: propsInverse('set_mask', ['isMask', 'maskType']),
  set_layout_grids: propsInverse('set_layout_grids', ['layoutGrids']),
  rename_node: propsInverse('rename_node', ['name']),
  // Text.
  set_text: textInverse('set_text'),
  set_text_properties: textInverse('set_text_properties'),
  set_text_range: textInverse('set_text_range'),
  find_replace_text: findReplaceInverse,
  // Layout.
  set_auto_layout: autoLayoutInverse,
  set_layout_props: layoutPropsInverse,
  // Styles and bindings on nodes.
  apply_style_to_node: applyStyleInverse,
  bind_variable_to_node: bindToNodeInverse,
  bind_variable_to_paint: bindToPaintInverse,
  // Multi-node.
  move_nodes: nodesSnapshot(
    'move_nodes',
    node => ('x' in node && 'y' in node ? { x: node.x, y: node.y } : null),
    (node, s) => {
      writeIfDifferent(node, 'x', s.x);
      writeIfDifferent(node, 'y', s.y);
    },
  ),
  resize_nodes: resizeNodesInverse,
  rotate_nodes: nodesSnapshot(
    'rotate_nodes',
    node => ('rotation' in node ? { rotation: (node as { rotation: number }).rotation } : null),
    (node, s) => writeIfDifferent(node, 'rotation', s.rotation),
    { resizes: true },
  ),
  lock_nodes: nodesSnapshot(
    'lock_nodes',
    node => ('locked' in node ? { locked: node.locked } : null),
    (node, s) => writeIfDifferent(node, 'locked', s.locked),
  ),
  unlock_nodes: nodesSnapshot(
    'unlock_nodes',
    node => ('locked' in node ? { locked: node.locked } : null),
    (node, s) => writeIfDifferent(node, 'locked', s.locked),
  ),
  batch_rename_nodes: batchRenameInverse,
  // Tree structure.
  reorder_nodes: reorderInverse,
  reparent_nodes: reparentInverse,
  group_nodes: groupInverse,
  combine_as_variants: combineInverse,
  // Instances.
  set_instance_properties: instancePropsInverse,
  swap_component: swapInverse,
  // Creates — undo removes whatever the op produced.
  create_frame: createInverse('create_frame'),
  create_rectangle: createInverse('create_rectangle'),
  create_text: createInverse('create_text'),
  create_ellipse: createInverse('create_ellipse'),
  create_component: createComponentInverse,
  create_section: createInverse('create_section'),
  import_image: createInverse('import_image'),
  import_svg: createInverse('import_svg'),
  create_instance: createInverse('create_instance'),
  clone_node: createInverse('clone_node', false),
  add_page: createInverse('add_page', false),
  create_paint_style: createdInverse('styleId', removeStyle),
  create_effect_style: createdInverse('styleId', removeStyle),
  create_grid_style: createdInverse('styleId', removeStyle),
  create_text_style: createdInverse('styleId', removeStyle),
  create_variable_collection: createdInverse('collectionId', async (figmaCtx, id) => {
    (await figmaCtx.variables.getVariableCollectionByIdAsync(id))?.remove();
  }),
  create_variable: createdInverse('variableId', async (figmaCtx, id) => {
    (await figmaCtx.variables.getVariableByIdAsync(id))?.remove();
  }),
  add_variable_mode: createdInverse('modeId', async (figmaCtx, modeId, params) => {
    const collectionId = paramsOf(params).collectionId;
    if (typeof collectionId !== 'string') return;
    const collection = await figmaCtx.variables.getVariableCollectionByIdAsync(collectionId);
    if (collection?.modes.some(m => m.modeId === modeId) === true) collection.removeMode(modeId);
  }),
  add_component_property: addPropertyInverse,
  // Styles.
  update_paint_style: styleInverse('update_paint_style', 'PAINT', 'paints'),
  update_effect_style: styleInverse('update_effect_style', 'EFFECT', 'effects'),
  update_text_style: textStyleInverse,
  // Variables.
  set_variable_value: variableValueInverse,
  set_variable_code_syntax: codeSyntaxInverse,
  rename_variable: renameVariableInverse,
  // Component properties.
  edit_component_property: editPropertyInverse,
  bind_component_property: bindPropertyInverse,
  // Prototype and pages.
  set_reactions: reactionsInverse('set_reactions'),
  remove_reactions: reactionsInverse('remove_reactions'),
  rename_page: propsInverse('rename_page', ['name'], { idKey: 'pageId' }),
  navigate_to_page: navigateInverse,
  // Motion (beta) — staggered authoring in one atomic, undoable call.
  apply_animation_style: applyAnimationStyleInverse,
  apply_manual_keyframe_track: keyframeTrackInverse('apply_manual_keyframe_track'),
  set_timeline_duration: setTimelineDurationInverse,
};

/**
 * The write tools a batch refuses, each with why no faithful inverse exists. Every write tool is in
 * exactly one of INVERSES and this map — a registry test holds that — so a new tool cannot join
 * either side without someone deciding which, and saying why when it is this one.
 */
export const NON_BATCHABLE: Readonly<Record<string, string>> = {
  delete_nodes: 'a deleted node cannot be brought back under its id',
  delete_page: 'a deleted page cannot be brought back under its id',
  delete_style:
    'a deleted style cannot be brought back under its id, and its consumers lose the link',
  delete_variable:
    'a deleted variable cannot be brought back under its id, and its bindings revert',
  delete_variable_collection:
    'a deleted collection cannot be brought back under its id, nor its variables and modes',
  delete_component_property:
    're-adding a property mints a new id, and the layers bound to the old one lose the binding',
  detach_instance: 'a detached instance is a plain frame that nothing can re-link to its component',
  ungroup_nodes: 'ungrouping deletes the group; grouping again makes a new group under a new id',
  remove_animation_style: 're-applying the preset mints a new applied-style id',
  remove_manual_keyframe_track:
    're-applying a removed track mints new track and keyframe ids (measured), so it cannot come back as it was',
};

interface ParsedOp {
  tool: string;
  params: unknown;
}

/**
 * The tools an op may name, derived from the inverse map rather than listed again — membership in
 * INVERSES _is_ the allowlist, so the two can never disagree. Exported for the cross-package
 * registry gate: the server refuses a batch op whose tool has no wire schema, so a tool that
 * becomes batchable without being plugin-dispatched would be refused before it ever reached this
 * handler.
 */
export const BATCHABLE_TOOLS: readonly string[] = Object.keys(INVERSES);

const parseOps = (params: unknown): ParsedOp[] => {
  const ops = (params as { ops?: unknown } | null)?.ops;
  if (!Array.isArray(ops)) throw new TypeError('batch: ops must be an array');
  if (ops.length === 0) throw new TypeError('batch: ops must not be empty');
  return ops.map((op, i) => {
    const o = op as { tool?: unknown; params?: unknown } | null;
    if (typeof o?.tool !== 'string') throw new TypeError(`batch: ops[${i}].tool must be a string`);
    if (INVERSES[o.tool] === undefined) {
      const why = NON_BATCHABLE[o.tool] ?? 'only write tools can be batched';
      throw new Error(`batch: op '${o.tool}' (index ${i}) is not batchable — ${why}`);
    }
    return { tool: o.tool, params: o.params ?? {} };
  });
};

/** Containers Figma deletes once their last child leaves — and a deleted node's id is gone. */
const SELF_DELETING = new Set(['GROUP', 'BOOLEAN_OPERATION', 'COMPONENT_SET']);

/**
 * Refuse a batch whose moves, taken together, would empty a container Figma then deletes. Each op's
 * capture sees the document as the batch found it, so no single capture can see two ops emptying a
 * group between them; this counts across the whole batch before anything runs.
 */
const refuseEmptiedContainers = async (
  figmaCtx: typeof figma,
  ops: readonly ParsedOp[],
): Promise<void> => {
  const leaving = new Map<
    string,
    { container: BaseNode & ChildrenMixin; ids: Set<string>; ops: Set<string> }
  >();
  /* eslint-disable no-await-in-loop -- few structural ops per batch; read-only */
  for (const [i, op] of ops.entries()) {
    const moves = INVERSES[op.tool]!.moves;
    if (moves === undefined) continue;
    const { nodeIds, destinationId } = await moves(figmaCtx, op.params);
    for (const id of nodeIds) {
      const node = await figmaCtx.getNodeByIdAsync(id);
      const parent = node !== null && 'parent' in node ? node.parent : null;
      if (parent === null || !SELF_DELETING.has(parent.type) || parent.id === destinationId)
        continue;
      const entry = leaving.get(parent.id) ?? {
        container: parent as BaseNode & ChildrenMixin,
        ids: new Set<string>(),
        ops: new Set<string>(),
      };
      entry.ids.add(id);
      entry.ops.add(`op ${i} (${op.tool})`);
      leaving.set(parent.id, entry);
    }
  }
  /* eslint-enable no-await-in-loop */
  for (const { container, ids, ops: by } of leaving.values()) {
    if (ids.size >= container.children.length) {
      throw new Error(
        `batch: ${[...by].join(', ')} would empty ${container.type} ${container.id}, which Figma ` +
          'then deletes — a deleted node cannot come back under its id, so this batch has no ' +
          'faithful rollback (move the container itself, or keep one child in it)',
      );
    }
  }
};

interface Captured {
  state: unknown;
  guard: InstanceGuard[];
  layout: LayoutScope;
}

const captureOp = async (figmaCtx: typeof figma, op: ParsedOp): Promise<Captured> => {
  const inverse = INVERSES[op.tool]!;
  const state = await inverse.capture(figmaCtx, op.params);
  const touched = inverse.touches?.(op.params, state) ?? [];
  const resized = inverse.resizes?.(op.params, state) ?? [];
  const [guard, layout] = await Promise.all([
    touched.length > 0 ? captureOverrideGuard(figmaCtx, touched) : [],
    resized.length > 0 ? captureLayoutScope(figmaCtx, resized) : [],
  ]);
  return { state, guard, layout };
};

/**
 * Undo one op: its own inverse, then the instance overrides it disturbed (a reset can resize an
 * instance), then any box the layout pushed. Resolves to the residue notes, if any.
 */
const undoOp = async (
  figmaCtx: typeof figma,
  op: ParsedOp,
  captured: Captured,
  result: unknown,
): Promise<string | undefined> => {
  const own = await INVERSES[op.tool]!.undo(figmaCtx, op.params, captured.state, result);
  const overrides =
    captured.guard.length > 0 ? await restoreOverrideGuard(figmaCtx, captured.guard) : undefined;
  await restoreLayoutDrift(figmaCtx, captured.layout);
  return notesOf([own, overrides]);
};

/**
 * Build the batch handler. `apply` is the map of raw write handlers (un-idempotent — the whole
 * batch carries one requestId and is wrapped once at the top level, so each op runs exactly once on
 * replay).
 */
export const createBatchHandler =
  (figmaCtx: typeof figma, apply: SandboxHandlers): SandboxToolHandler =>
  async params => {
    const ops = parseOps(params);
    for (const op of ops) {
      if (apply[op.tool] === undefined) throw new Error(`batch: no handler for op '${op.tool}'`);
    }
    await refuseEmptiedContainers(figmaCtx, ops);

    // Phase 1 — capture (read-only). Reads are independent, so resolve them together. A Figma API
    // can reject with a bare string (measured: "Unable to establish connection to Figma after 10
    // seconds"); pass that on as an Error that says nothing was applied yet, rather than raw.
    let captured: Captured[];
    try {
      captured = await Promise.all(ops.map(async op => captureOp(figmaCtx, op)));
    } catch (err) {
      if (err instanceof Error) throw err;
      throw new Error(`batch: capture failed before any op was applied: ${String(err)}`, {
        cause: err,
      });
    }

    // Phase 2 — apply in order; roll back already-applied ops on the first failure.
    const results: unknown[] = [];
    /* eslint-disable no-await-in-loop -- apply order is significant and rollback needs partial results */
    for (let i = 0; i < ops.length; i += 1) {
      const op = ops[i]!;
      try {
        results.push(await apply[op.tool]!(op.params));
      } catch (err) {
        // Unwind applied ops in reverse. Keep going even if one undo throws, but record which ones
        // failed — and which restored with residue — so the error never claims a clean rollback
        // that didn't happen.
        const undoFailures: string[] = [];
        const residue: string[] = [];
        for (let j = i - 1; j >= 0; j -= 1) {
          try {
            const note = await undoOp(figmaCtx, ops[j]!, captured[j]!, results[j]);
            if (note !== undefined) residue.push(`op ${j} (${ops[j]!.tool}): ${note}`);
          } catch (undoErr) {
            const m = undoErr instanceof Error ? undoErr.message : String(undoErr);
            undoFailures.push(`op ${j} (${ops[j]!.tool}): ${m}`);
          }
        }
        const message = err instanceof Error ? err.message : String(err);
        const rollback =
          undoFailures.length === 0
            ? `rolled back ${i} applied op(s)`
            : `rolled back ${i - undoFailures.length}/${i} op(s); ${undoFailures.length} undo(s) FAILED [${undoFailures.join('; ')}] — document may be partially changed`;
        const leftover =
          residue.length === 0 ? '' : ` (restored with residue: ${residue.join('; ')})`;
        throw new Error(`batch: op ${i} (${op.tool}) failed, ${rollback}${leftover}: ${message}`, {
          cause: err,
        });
      }
    }
    /* eslint-enable no-await-in-loop */

    const result: BatchResult = { ok: true, results };
    return result;
  };
