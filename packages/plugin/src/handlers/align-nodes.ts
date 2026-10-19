import type { BatchNodeResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Edge = 'MIN' | 'CENTER' | 'MAX';

/** The linear part of a transform, row-major: x' = a·x + c·y, y' = b·x + d·y. */
interface Linear {
  a: number;
  b: number;
  c: number;
  d: number;
}

interface Placed {
  absoluteTransform: Transform;
  relativeTransform: Transform;
  width: number;
  height: number;
  x: number;
  y: number;
}

interface Target {
  node: SceneNode & Placed;
  /** The box alignment measures, in the space the reference is in. */
  box: Box;
  /** That space's linear part, mapping a delta measured in it onto the canvas. */
  space: Linear;
  /** The reference box (parent or selection) in the same space; set below for SELECTION. */
  ref: Box | null;
  /** The node's on-canvas bounding box, which distribute spaces by. */
  canvasBox: Box;
}

const EDGES: ReadonlySet<string> = new Set(['MIN', 'CENTER', 'MAX']);
const IDENTITY: Linear = { a: 1, b: 0, c: 0, d: 1 };

const edgeParam = (value: unknown, name: string): Edge | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !EDGES.has(value)) {
    throw new TypeError(`align_nodes: ${name} must be MIN, CENTER or MAX`);
  }
  return value as Edge;
};

/** Where a box of `size` sits along an axis, given the reference span `[start, start + span]`. */
const place = (edge: Edge, start: number, span: number, size: number): number => {
  if (edge === 'MIN') return start;
  if (edge === 'CENTER') return start + (span - size) / 2;
  return start + span - size;
};

const union = (boxes: readonly Box[]): Box => {
  const x = Math.min(...boxes.map(b => b.x));
  const y = Math.min(...boxes.map(b => b.y));
  const right = Math.max(...boxes.map(b => b.x + b.width));
  const bottom = Math.max(...boxes.map(b => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
};

const linear = (t: Transform): Linear => ({ a: t[0][0], c: t[0][1], b: t[1][0], d: t[1][1] });

const multiply = (m: Linear, n: Linear): Linear => ({
  a: m.a * n.a + m.c * n.b,
  b: m.b * n.a + m.d * n.b,
  c: m.a * n.c + m.c * n.d,
  d: m.b * n.c + m.d * n.d,
});

const invert = (m: Linear): Linear | null => {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-9) return null;
  return { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det };
};

const apply = (m: Linear, x: number, y: number): [number, number] => [
  m.a * x + m.c * y,
  m.b * x + m.d * y,
];

/**
 * The axis-aligned box of a node's own rectangle, seen from a space whose canvas transform is
 * `space` + `origin`. With the canvas as the space this is the node's absoluteBoundingBox; with its
 * parent as the space it is the box as the parent's own (possibly rotated) axes see it.
 */
const boxIn = (node: Placed, toSpace: Linear, origin: [number, number]): Box => {
  const t = node.absoluteTransform;
  const corners: [number, number][] = [
    [0, 0],
    [node.width, 0],
    [0, node.height],
    [node.width, node.height],
  ].map(([cx, cy]) => {
    const canvasX = t[0][0] * cx! + t[0][1] * cy! + t[0][2] - origin[0];
    const canvasY = t[1][0] * cx! + t[1][1] * cy! + t[1][2] - origin[1];
    return apply(toSpace, canvasX, canvasY);
  });
  const xs = corners.map(c => c[0]);
  const ys = corners.map(c => c[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
};

const isPlaced = (node: BaseNode): node is SceneNode & Placed =>
  'absoluteTransform' in node &&
  'relativeTransform' in node &&
  'width' in node &&
  'height' in node &&
  'x' in node;

/** The nearest INSTANCE strictly above `node`, if any — its sublayers cannot be moved. */
const enclosingInstance = (node: BaseNode): BaseNode | null => {
  for (let up = node.parent; up !== null; up = up.parent) {
    if (up.type === 'INSTANCE') return up;
  }
  return null;
};

/**
 * Align and/or distribute nodes like Figma's own toolbar.
 *
 * RelativeTo PARENT measures in the parent's own axes — so "left" in a rotated frame is that
 * frame's left edge, not the edge of its on-canvas bounding box — while SELECTION and distribute
 * measure on the canvas, as Figma does for a multi-selection.
 *
 * Everything is checked before anything is written: a bad id, an in-flow auto-layout child, a
 * sublayer of an instance, a node whose ancestor is also being moved, or a nonsensical combination
 * throws with no node moved. If a write still throws, the nodes already moved are put back.
 */
export const createAlignNodesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      nodeIds?: unknown;
      horizontal?: unknown;
      vertical?: unknown;
      relativeTo?: unknown;
      distribute?: unknown;
    };
    if (
      !Array.isArray(p.nodeIds) ||
      p.nodeIds.length === 0 ||
      p.nodeIds.some(id => typeof id !== 'string')
    ) {
      throw new TypeError('align_nodes: nodeIds must be a non-empty string[]');
    }
    const horizontal = edgeParam(p.horizontal, 'horizontal');
    const vertical = edgeParam(p.vertical, 'vertical');
    const relativeTo = p.relativeTo ?? 'PARENT';
    if (relativeTo !== 'PARENT' && relativeTo !== 'SELECTION') {
      throw new TypeError('align_nodes: relativeTo must be PARENT or SELECTION');
    }
    if (
      p.distribute !== undefined &&
      p.distribute !== 'HORIZONTAL' &&
      p.distribute !== 'VERTICAL'
    ) {
      throw new TypeError('align_nodes: distribute must be HORIZONTAL or VERTICAL');
    }
    const distribute = p.distribute as 'HORIZONTAL' | 'VERTICAL' | undefined;
    if (horizontal === undefined && vertical === undefined && distribute === undefined) {
      throw new TypeError('align_nodes: pass horizontal, vertical and/or distribute');
    }
    if (
      (distribute === 'HORIZONTAL' && horizontal !== undefined) ||
      (distribute === 'VERTICAL' && vertical !== undefined)
    ) {
      throw new TypeError(
        `align_nodes: distribute ${distribute} cannot be combined with ${
          distribute === 'HORIZONTAL' ? 'horizontal' : 'vertical'
        } alignment — both place the nodes along the same axis`,
      );
    }
    // A repeated id would be moved once per mention.
    const ids = [...new Set(p.nodeIds as readonly string[])];
    if (distribute !== undefined && ids.length < 3) {
      throw new TypeError('align_nodes: distribute needs at least 3 distinct nodes');
    }
    const canvasSpace = relativeTo === 'SELECTION';

    const resolved = await Promise.all(ids.map(id => figmaCtx.getNodeByIdAsync(id)));
    const idSet = new Set(ids);
    const targets: Target[] = resolved.map((node, i) => {
      const id = ids[i]!;
      if (node === null) throw new Error(`align_nodes: node ${id} not found`);
      if (!isPlaced(node)) {
        throw new Error(
          `align_nodes: node ${id} is a ${node.type}, which has no position to align`,
        );
      }
      const instance = enclosingInstance(node);
      if (instance !== null) {
        throw new Error(
          `align_nodes: node ${id} is a layer inside instance ${instance.id}, whose sublayers ` +
            `cannot be moved — align the instance itself, or edit its main component.`,
        );
      }
      for (let up = node.parent; up !== null; up = up.parent) {
        if (idSet.has(up.id)) {
          throw new Error(
            `align_nodes: node ${id} is inside ${up.id}, which is also being aligned — moving ` +
              `${up.id} already carries it. Align them in separate calls.`,
          );
        }
      }
      const parent = node.parent;
      const inFlow =
        parent !== null &&
        'layoutMode' in parent &&
        (parent as { layoutMode: string }).layoutMode !== 'NONE' &&
        'layoutPositioning' in node &&
        (node as { layoutPositioning: string }).layoutPositioning !== 'ABSOLUTE';
      if (inFlow) {
        throw new Error(
          `align_nodes: node ${id} is an in-flow child of an auto-layout frame — the layout ` +
            `controls its position and would reflow it back. Align it with the parent's ` +
            `primaryAxisAlignItems / counterAxisAlignItems or its own layoutAlign instead, or ` +
            `set layoutPositioning ABSOLUTE (set_layout_props) first.`,
        );
      }

      const canvasBox = boxIn(node, IDENTITY, [0, 0]);
      if (canvasSpace || (horizontal === undefined && vertical === undefined)) {
        return { node, box: canvasBox, space: IDENTITY, ref: null, canvasBox };
      }
      if (parent === null || !isPlaced(parent)) {
        throw new Error(
          `align_nodes: node ${id} sits directly on a page, which has no bounds to align ` +
            `within — use relativeTo SELECTION to align it to the other nodes`,
        );
      }
      const space = linear(parent.absoluteTransform);
      const toSpace = invert(space);
      if (toSpace === null) {
        throw new Error(`align_nodes: parent ${parent.id} is scaled to zero, so has no axes`);
      }
      const origin: [number, number] = [
        parent.absoluteTransform[0][2],
        parent.absoluteTransform[1][2],
      ];
      return {
        node,
        box: boxIn(node, toSpace, origin),
        space,
        ref: { x: 0, y: 0, width: parent.width, height: parent.height },
        canvasBox,
      };
    });

    if (canvasSpace) {
      const selection = union(targets.map(t => t.box));
      for (const t of targets) t.ref = selection;
    }

    // Canvas-space deltas, computed for every node before any is applied. Alignment is measured in
    // each target's own space and mapped onto the canvas; distribute already measures there.
    const deltas = new Map<Target, [number, number]>();
    for (const t of targets) {
      const ref = t.ref!;
      const dx =
        horizontal === undefined ? 0 : place(horizontal, ref.x, ref.width, t.box.width) - t.box.x;
      const dy =
        vertical === undefined ? 0 : place(vertical, ref.y, ref.height, t.box.height) - t.box.y;
      deltas.set(t, apply(t.space, dx, dy));
    }

    if (distribute !== undefined) {
      const horizontalAxis = distribute === 'HORIZONTAL';
      const start = (b: Box): number => (horizontalAxis ? b.x : b.y);
      const size = (b: Box): number => (horizontalAxis ? b.width : b.height);
      const ordered = targets.toSorted((a, b) => start(a.canvasBox) - start(b.canvasBox));
      const first = ordered[0]!.canvasBox;
      const last = ordered.at(-1)!.canvasBox;
      const span = start(last) + size(last) - start(first);
      const used = ordered.reduce((sum, t) => sum + size(t.canvasBox), 0);
      const gap = (span - used) / (ordered.length - 1);
      let cursor = start(first);
      for (const t of ordered) {
        deltas.get(t)![horizontalAxis ? 0 : 1] += cursor - start(t.canvasBox);
        cursor += size(t.canvasBox) + gap;
      }
    }

    // x/y live in the node's coordinate parent (for a child of a group, the group's own parent),
    // whose linear part is absolute · relative⁻¹ — read off the node itself, never assumed.
    const moves = targets.flatMap(t => {
      const [cx, cy] = deltas.get(t)!;
      if (cx === 0 && cy === 0) return [];
      const rel = invert(linear(t.node.relativeTransform));
      const coordinate =
        rel === null ? null : invert(multiply(linear(t.node.absoluteTransform), rel));
      const [lx, ly] = coordinate === null ? [cx, cy] : apply(coordinate, cx, cy);
      return [{ node: t.node, x: t.node.x + lx, y: t.node.y + ly }];
    });

    // A write that throws part-way puts back every node already touched — including the one that
    // threw, whose x may have landed before its y failed. Each restore writes only what changed and
    // is attempted on its own, so one node that refuses cannot strand the rest.
    const touched: { node: Placed; x: number; y: number }[] = [];
    try {
      for (const move of moves) {
        touched.push({ node: move.node, x: move.node.x, y: move.node.y });
        move.node.x = move.x;
        move.node.y = move.y;
      }
    } catch (error) {
      for (const prev of touched.toReversed()) {
        try {
          if (prev.node.x !== prev.x) prev.node.x = prev.x;
          if (prev.node.y !== prev.y) prev.node.y = prev.y;
        } catch {
          // Best effort: the original error below is the one worth reporting.
        }
      }
      throw error;
    }

    const result: BatchNodeResult = { ok: true, affected: ids };
    return result;
  };
