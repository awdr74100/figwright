import type { BatchResult } from '@figwright/shared';

import type { SandboxHandlers, SandboxToolHandler } from '../dispatcher.js';
import { assertFigmaEditor, isMotionNode, toPlainJson } from './motion-shared.js';

/**
 * Atomic batch: apply several invertible write ops as a unit. Two phases —
 *
 * 1. Capture (read-only): resolve every op's target and snapshot what undo needs. Any failure here
 *    aborts before a single mutation, so a bad op id never leaves the document half-changed.
 * 2. Apply: run the real write handlers in order; if one throws, undo the already-applied ops in
 *    reverse and reject. Reuses the existing handlers for apply so there is no second copy of the
 *    mutation logic — this module only adds the inverse (undo) for each invertible op.
 *
 * Only ops with a registered inverse are accepted; destructive ops (delete_*, ungroup, …) have no
 * faithful inverse and are rejected at validate time, keeping the all-or-nothing guarantee honest.
 */

/** Per-op inverse. `capture` runs before any mutation; `undo` restores the pre-op state on rollback. */
interface BatchInverse {
  /**
   * Read-only: validate the target and snapshot whatever `undo` will need. Throw to abort the
   * batch.
   */
  capture(figmaCtx: typeof figma, params: unknown): Promise<unknown>;
  /** Restore the pre-op state. Receives the capture snapshot and the op's apply result. Best-effort. */
  undo(figmaCtx: typeof figma, params: unknown, captured: unknown, result: unknown): Promise<void>;
}

/**
 * Restoring a `figma.mixed` (symbol) value would throw, so skip those — imperfect but never
 * crashes.
 */
const restorable = (value: unknown): boolean => typeof value !== 'symbol';

/** Single-node op: snapshot the given properties and restore them on undo. props[0] is required. */
const nodeProps = (tool: string, props: readonly string[]): BatchInverse => ({
  async capture(figmaCtx, params) {
    const id = (params as { nodeId?: unknown } | null)?.nodeId;
    if (typeof id !== 'string') throw new TypeError(`batch/${tool}: nodeId must be a string`);
    const node = await figmaCtx.getNodeByIdAsync(id);
    if (node === null) throw new Error(`batch/${tool}: node ${id} not found`);
    const required = props[0]!;
    if (!(required in node)) throw new Error(`batch/${tool}: node ${id} has no ${required}`);
    const bag = node as unknown as Record<string, unknown>;
    const snapshot: Record<string, unknown> = {};
    for (const k of props) if (k in node) snapshot[k] = bag[k];
    return { id, snapshot };
  },
  async undo(figmaCtx, _params, captured) {
    const { id, snapshot } = captured as { id: string; snapshot: Record<string, unknown> };
    const node = await figmaCtx.getNodeByIdAsync(id);
    if (node === null) return;
    const bag = node as unknown as Record<string, unknown>;
    for (const k of Object.keys(snapshot)) {
      if (k in node && restorable(snapshot[k])) bag[k] = snapshot[k];
    }
  },
});

/** Multi-node op: snapshot per applicable node via `read`, restore via `write` on undo. */
const nodesSnapshot = (
  tool: string,
  read: (node: SceneNode) => Record<string, unknown> | null,
  write: (node: SceneNode, snap: Record<string, unknown>) => void,
): BatchInverse => ({
  async capture(figmaCtx, params) {
    const ids = (params as { nodeIds?: unknown } | null)?.nodeIds;
    if (!Array.isArray(ids) || ids.some(i => typeof i !== 'string')) {
      throw new TypeError(`batch/${tool}: nodeIds must be a string[]`);
    }
    const nodes = await Promise.all((ids as string[]).map(id => figmaCtx.getNodeByIdAsync(id)));
    const snaps: { id: string; snap: Record<string, unknown> }[] = [];
    nodes.forEach((node, i) => {
      if (node === null) return;
      const snap = read(node as SceneNode);
      if (snap !== null) snaps.push({ id: (ids as string[])[i]!, snap });
    });
    return snaps;
  },
  async undo(figmaCtx, _params, captured) {
    const snaps = captured as { id: string; snap: Record<string, unknown> }[];
    const nodes = await Promise.all(snaps.map(s => figmaCtx.getNodeByIdAsync(s.id)));
    nodes.forEach((node, i) => {
      if (node !== null) write(node as SceneNode, snaps[i]!.snap);
    });
  },
});

/** Create op: validate parentId (if any) up front; undo removes the node the op created. */
const createInverse = (tool: string, hasParent = true): BatchInverse => ({
  async capture(figmaCtx, params) {
    if (!hasParent) return null;
    const parentId = (params as { parentId?: unknown } | null)?.parentId;
    if (typeof parentId !== 'string') return null;
    const parent = await figmaCtx.getNodeByIdAsync(parentId);
    if (parent === null || !('appendChild' in parent)) {
      throw new Error(`batch/${tool}: parent ${parentId} not found or cannot contain children`);
    }
    return null;
  },
  async undo(figmaCtx, _params, _captured, result) {
    const id = (result as { nodeId?: unknown } | null)?.nodeId;
    if (typeof id !== 'string') return;
    const node = await figmaCtx.getNodeByIdAsync(id);
    if (node !== null && 'remove' in node) (node as { remove(): void }).remove();
  },
});

/**
 * Create_component is invertible as an empty create (undo removes the new node), but `fromNodeId`
 * componentizes — and consumes — an existing node, which has no faithful inverse (removing the
 * component would destroy the original). Reject that variant up front, like other non-invertible
 * ops.
 */
const componentCreateInverse = createInverse('create_component');
const createComponentInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    if (typeof (params as { fromNodeId?: unknown } | null)?.fromNodeId === 'string') {
      throw new Error(
        'batch/create_component: fromNodeId is not batchable — componentizing a node consumes it and has no faithful inverse',
      );
    }
    return componentCreateInverse.capture(figmaCtx, params);
  },
  undo: componentCreateInverse.undo,
};

// Every field the set_text_properties handler can write. The snapshot must cover all of them —
// an inverse that captures a subset would "roll back" while silently leaving the rest changed,
// breaking the all-or-nothing contract. Restore order matters at the tail: maxLines only takes
// effect once textTruncation is ENDING, so truncation is restored before maxLines (mirrors the
// handler's apply order).
const TEXT_PROPERTY_KEYS = [
  'fontName',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'textCase',
  'textDecoration',
  'paragraphSpacing',
  'paragraphIndent',
  'textAutoResize',
  'textTruncation',
  'maxLines',
] as const;

/**
 * Set_text_properties mutates typography, which Figma only allows with the node's fonts loaded — so
 * the undo must reload the captured fonts before restoring, exactly like setTextInverse. A per-run
 * `mixed` value (symbol) can't be restored node-level and is skipped; every other field
 * round-trips.
 */
const setTextPropertiesInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    const id = (params as { nodeId?: unknown } | null)?.nodeId;
    if (typeof id !== 'string') {
      throw new TypeError('batch/set_text_properties: nodeId must be a string');
    }
    const node = await figmaCtx.getNodeByIdAsync(id);
    if (node === null || node.type !== 'TEXT') {
      throw new Error(`batch/set_text_properties: node ${id} is not a TEXT node`);
    }
    const text = node as TextNode;
    const fonts =
      text.fontName === figmaCtx.mixed && text.characters.length > 0
        ? text.getRangeAllFontNames(0, text.characters.length)
        : [text.fontName as FontName];
    const bag = text as unknown as Record<string, unknown>;
    const snapshot: Record<string, unknown> = {};
    for (const k of TEXT_PROPERTY_KEYS) if (k in text) snapshot[k] = bag[k];
    return { id, snapshot, fonts };
  },
  async undo(figmaCtx, _params, captured) {
    const { id, snapshot, fonts } = captured as {
      id: string;
      snapshot: Record<string, unknown>;
      fonts: FontName[];
    };
    const node = await figmaCtx.getNodeByIdAsync(id);
    if (node === null || node.type !== 'TEXT') return;
    await Promise.all(fonts.map(font => figmaCtx.loadFontAsync(font)));
    const bag = node as unknown as Record<string, unknown>;
    for (const k of TEXT_PROPERTY_KEYS) {
      if (k in snapshot && k in node && restorable(snapshot[k])) bag[k] = snapshot[k];
    }
  },
};

/** Set_text needs every font loaded before `characters` can be restored. */
const setTextInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    const id = (params as { nodeId?: unknown } | null)?.nodeId;
    if (typeof id !== 'string') throw new TypeError('batch/set_text: nodeId must be a string');
    const node = await figmaCtx.getNodeByIdAsync(id);
    if (node === null || node.type !== 'TEXT') {
      throw new Error(`batch/set_text: node ${id} is not a TEXT node`);
    }
    const text = node as TextNode;
    const fonts =
      text.fontName === figmaCtx.mixed && text.characters.length > 0
        ? text.getRangeAllFontNames(0, text.characters.length)
        : [text.fontName as FontName];
    return { id, characters: text.characters, fonts };
  },
  async undo(figmaCtx, _params, captured) {
    const { id, characters, fonts } = captured as {
      id: string;
      characters: string;
      fonts: FontName[];
    };
    const node = await figmaCtx.getNodeByIdAsync(id);
    if (node === null || node.type !== 'TEXT') return;
    await Promise.all(fonts.map(font => figmaCtx.loadFontAsync(font)));
    (node as TextNode).characters = characters;
  },
};

// ── Motion (beta) inverses ───────────────────────────────────────────────────
// Motion authoring joins the batch only where the pre-op state snapshots faithfully — the stagger
// hot-path. apply_animation_style undoes via the appliedStyleId the apply returns; a PROPERTY
// keyframe track round-trips through a deep-cloned snapshot. Indexed fills/strokes/effects tracks
// have no faithful snapshot yet, so they're rejected up front (same honesty stance as
// create_component's fromNodeId) to keep all-or-nothing real. All three gate on the Figma editor.

const applyAnimationStyleInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    assertFigmaEditor(figmaCtx, 'batch/apply_animation_style');
    const id = (params as { nodeId?: unknown } | null)?.nodeId;
    if (typeof id !== 'string') {
      throw new TypeError('batch/apply_animation_style: nodeId must be a string');
    }
    const node = await figmaCtx.getNodeByIdAsync(id);
    if (node === null || !isMotionNode(node)) {
      throw new Error(
        `batch/apply_animation_style: node ${id} not found or does not support Motion`,
      );
    }
    return null; // undo relies on the appliedStyleId in the apply result
  },
  async undo(figmaCtx, _params, _captured, result) {
    const r = result as { nodeId?: unknown; appliedStyleId?: unknown } | null;
    if (typeof r?.nodeId !== 'string' || typeof r.appliedStyleId !== 'string') return;
    const node = await figmaCtx.getNodeByIdAsync(r.nodeId);
    if (node !== null && isMotionNode(node)) node.removeAnimationStyle(r.appliedStyleId);
  },
};

const applyManualKeyframeTrackInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    assertFigmaEditor(figmaCtx, 'batch/apply_manual_keyframe_track');
    const p = (params ?? {}) as { nodeId?: unknown; field?: unknown };
    if (typeof p.nodeId !== 'string') {
      throw new TypeError('batch/apply_manual_keyframe_track: nodeId must be a string');
    }
    const field = p.field as { type?: unknown; name?: unknown } | null;
    if (field?.type !== 'PROPERTY' || typeof field.name !== 'string') {
      throw new Error(
        'batch/apply_manual_keyframe_track: only PROPERTY fields are batchable — indexed fills/strokes/effects tracks have no faithful snapshot',
      );
    }
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !isMotionNode(node)) {
      throw new Error(
        `batch/apply_manual_keyframe_track: node ${p.nodeId} not found or does not support Motion`,
      );
    }
    const tracks = node.manualKeyframeTracks as Record<string, unknown>;
    const previous = tracks[field.name];
    // Deep-clone so the snapshot can't be mutated by the apply that follows.
    return {
      id: p.nodeId,
      field: p.field,
      previous: previous === undefined ? null : toPlainJson(previous),
    };
  },
  async undo(figmaCtx, _params, captured) {
    const { id, field, previous } = captured as {
      id: string;
      field: KeyframeField;
      previous: ManualKeyframeTrackInput | null;
    };
    const node = await figmaCtx.getNodeByIdAsync(id);
    if (node === null || !isMotionNode(node)) return;
    if (previous === null) node.removeManualKeyframeTrack(field);
    else node.applyManualKeyframeTrack(field, previous);
  },
};

const setTimelineDurationInverse: BatchInverse = {
  async capture(figmaCtx, params) {
    assertFigmaEditor(figmaCtx, 'batch/set_timeline_duration');
    const p = (params ?? {}) as { nodeId?: unknown; timelineId?: unknown };
    if (typeof p.nodeId !== 'string') {
      throw new TypeError('batch/set_timeline_duration: nodeId must be a string');
    }
    if (typeof p.timelineId !== 'string') {
      throw new TypeError('batch/set_timeline_duration: timelineId must be a string');
    }
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !isMotionNode(node)) {
      throw new Error(
        `batch/set_timeline_duration: node ${p.nodeId} not found or does not support Motion`,
      );
    }
    const timeline = node.timelines.find(t => t.id === p.timelineId);
    if (timeline === undefined) {
      throw new Error(
        `batch/set_timeline_duration: timeline ${p.timelineId} not found on node ${p.nodeId}`,
      );
    }
    return { id: p.nodeId, timelineId: p.timelineId, duration: timeline.duration };
  },
  async undo(figmaCtx, _params, captured) {
    const { id, timelineId, duration } = captured as {
      id: string;
      timelineId: string;
      duration: number;
    };
    const node = await figmaCtx.getNodeByIdAsync(id);
    if (node === null || !isMotionNode(node)) return;
    node.setTimelineDuration(timelineId, duration);
  },
};

/** Tool name → inverse. Membership here is the allowlist: only these ops may appear in a batch. */
const INVERSES: Readonly<Record<string, BatchInverse>> = {
  // Single-node property mutations.
  set_fills: nodeProps('set_fills', ['fills']),
  // Snapshot every field the handler can write, not just the headline one: a subset snapshot would
  // "roll back" while silently leaving the rest changed. The per-side weights are also what rescue
  // a node whose uniform strokeWeight reads figma.mixed (a symbol, skipped by `restorable`) — they
  // are plain numbers, so mixed-stroke nodes still restore fully. Order matters: the uniform weight
  // is restored before the per-side values so the sides override it (mirrors the handler).
  set_strokes: nodeProps('set_strokes', [
    'strokes',
    'strokeWeight',
    'strokeAlign',
    'dashPattern',
    'strokeTopWeight',
    'strokeRightWeight',
    'strokeBottomWeight',
    'strokeLeftWeight',
  ]),
  set_opacity: nodeProps('set_opacity', ['opacity']),
  set_visible: nodeProps('set_visible', ['visible']),
  // Same full-coverage rule as set_strokes: per-corner radii are plain numbers, so a node whose
  // uniform cornerRadius reads figma.mixed (skipped by `restorable`) still restores through them
  // (a plain-cornerRadius node like an ellipse has no per-corner props — the `in node` guard skips
  // them and the uniform value alone round-trips). Uniform first, corners after (handler order).
  set_corner_radius: nodeProps('set_corner_radius', [
    'cornerRadius',
    'topLeftRadius',
    'topRightRadius',
    'bottomRightRadius',
    'bottomLeftRadius',
  ]),
  set_arc: nodeProps('set_arc', ['arcData']),
  set_blend_mode: nodeProps('set_blend_mode', ['blendMode']),
  set_effects: nodeProps('set_effects', ['effects']),
  set_constraints: nodeProps('set_constraints', ['constraints']),
  rename_node: nodeProps('rename_node', ['name']),
  set_text: setTextInverse,
  set_text_properties: setTextPropertiesInverse,
  // Multi-node mutations.
  move_nodes: nodesSnapshot(
    'move_nodes',
    node => ('x' in node && 'y' in node ? { x: node.x, y: node.y } : null),
    (node, s) => {
      (node as { x: number; y: number }).x = s.x as number;
      (node as { x: number; y: number }).y = s.y as number;
    },
  ),
  resize_nodes: nodesSnapshot(
    'resize_nodes',
    node =>
      typeof (node as { resize?: unknown }).resize === 'function'
        ? { width: node.width, height: node.height }
        : null,
    (node, s) =>
      (node as { resize(w: number, h: number): void }).resize(
        s.width as number,
        s.height as number,
      ),
  ),
  rotate_nodes: nodesSnapshot(
    'rotate_nodes',
    node => ('rotation' in node ? { rotation: (node as { rotation: number }).rotation } : null),
    (node, s) => ((node as { rotation: number }).rotation = s.rotation as number),
  ),
  lock_nodes: nodesSnapshot(
    'lock_nodes',
    node => ('locked' in node ? { locked: node.locked } : null),
    (node, s) => (node.locked = s.locked as boolean),
  ),
  unlock_nodes: nodesSnapshot(
    'unlock_nodes',
    node => ('locked' in node ? { locked: node.locked } : null),
    (node, s) => (node.locked = s.locked as boolean),
  ),
  // Creates — undo removes whatever node the op produced.
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
  // Motion (beta) — staggered authoring in one atomic, undoable call.
  apply_animation_style: applyAnimationStyleInverse,
  apply_manual_keyframe_track: applyManualKeyframeTrackInverse,
  set_timeline_duration: setTimelineDurationInverse,
};

interface ParsedOp {
  tool: string;
  params: unknown;
}

const parseOps = (params: unknown): ParsedOp[] => {
  const ops = (params as { ops?: unknown } | null)?.ops;
  if (!Array.isArray(ops)) throw new TypeError('batch: ops must be an array');
  if (ops.length === 0) throw new TypeError('batch: ops must not be empty');
  return ops.map((op, i) => {
    const o = op as { tool?: unknown; params?: unknown } | null;
    if (typeof o?.tool !== 'string') throw new TypeError(`batch: ops[${i}].tool must be a string`);
    if (INVERSES[o.tool] === undefined) {
      throw new Error(
        `batch: op '${o.tool}' (index ${i}) is not batchable — only invertible writes are allowed`,
      );
    }
    return { tool: o.tool, params: o.params ?? {} };
  });
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

    // Phase 1 — capture (read-only). Reads are independent, so resolve them together.
    const captured = await Promise.all(
      ops.map(op => INVERSES[op.tool]!.capture(figmaCtx, op.params)),
    );

    // Phase 2 — apply in order; roll back already-applied ops on the first failure.
    const results: unknown[] = [];
    /* eslint-disable no-await-in-loop -- apply order is significant and rollback needs partial results */
    for (let i = 0; i < ops.length; i += 1) {
      const op = ops[i]!;
      try {
        results.push(await apply[op.tool]!(op.params));
      } catch (err) {
        // Unwind applied ops in reverse. Keep going even if one undo throws, but record which ones
        // failed so the error never claims a clean rollback that didn't happen.
        const undoFailures: string[] = [];
        for (let j = i - 1; j >= 0; j -= 1) {
          try {
            await INVERSES[ops[j]!.tool]!.undo(figmaCtx, ops[j]!.params, captured[j], results[j]);
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
        throw new Error(`batch: op ${i} (${op.tool}) failed, ${rollback}: ${message}`, {
          cause: err,
        });
      }
    }
    /* eslint-enable no-await-in-loop */

    const result: BatchResult = { ok: true, results };
    return result;
  };
