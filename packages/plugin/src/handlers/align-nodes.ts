import type { BatchNodeResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Edge = 'MIN' | 'CENTER' | 'MAX';

interface Target {
  node: SceneNode;
  box: Box;
}

const EDGES: ReadonlySet<string> = new Set(['MIN', 'CENTER', 'MAX']);

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

/**
 * Express a canvas-space translation in the node's parent space. A node's x/y are the translation
 * of its transform relative to its parent, so when the parent (or an ancestor) is rotated, adding
 * the canvas delta to x/y would slide the node off-axis. Multiplying by the inverse of the parent's
 * linear part undoes that; for an unrotated parent it is the identity.
 */
const toParentSpace = (parent: BaseNode | null, dx: number, dy: number): [number, number] => {
  const transform =
    parent !== null && 'absoluteTransform' in parent
      ? (parent as { absoluteTransform: Transform }).absoluteTransform
      : null;
  if (transform === null) return [dx, dy];
  const [[a, c], [b, d]] = transform;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-9) return [dx, dy];
  return [(d * dx - c * dy) / det, (-b * dx + a * dy) / det];
};

/**
 * Align and/or distribute nodes by their on-canvas bounding boxes, like Figma's own toolbar.
 *
 * Everything is checked before anything is written: a bad id, a node with no bounds, an in-flow
 * auto-layout child or a nonsensical combination throws with no node moved, so a refusal never
 * leaves half the selection aligned. An in-flow child is refused rather than written because Figma
 * would silently reflow it back and this tool would report a success that changed nothing.
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
    const ids = p.nodeIds as readonly string[];
    if (distribute !== undefined && ids.length < 3) {
      throw new TypeError('align_nodes: distribute needs at least 3 nodes');
    }

    const nodes = await Promise.all(ids.map(id => figmaCtx.getNodeByIdAsync(id)));
    const targets: Target[] = nodes.map((node, i) => {
      const id = ids[i]!;
      if (node === null) throw new Error(`align_nodes: node ${id} not found`);
      const box = 'absoluteBoundingBox' in node ? (node.absoluteBoundingBox as Box | null) : null;
      if (box === null || box === undefined) {
        throw new Error(
          `align_nodes: node ${id} has no bounds to align (a page, or a node with no layout box)`,
        );
      }
      const parent = (node as SceneNode).parent;
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
      return { node: node as SceneNode, box };
    });

    const reference = (target: Target): Box => {
      if (relativeTo === 'SELECTION') return union(targets.map(t => t.box));
      const parent = target.node.parent;
      const parentBox =
        parent !== null && 'absoluteBoundingBox' in parent
          ? (parent.absoluteBoundingBox as Box | null)
          : null;
      if (parentBox === null || parentBox === undefined) {
        throw new Error(
          `align_nodes: node ${target.node.id} sits directly on a page, which has no bounds to ` +
            `align within — use relativeTo SELECTION to align it to the other nodes`,
        );
      }
      return parentBox;
    };

    // Canvas-space deltas, computed for every node before any is applied.
    const deltas = new Map<Target, [number, number]>();
    for (const t of targets) deltas.set(t, [0, 0]);

    if (horizontal !== undefined || vertical !== undefined) {
      for (const t of targets) {
        const ref = reference(t);
        const d = deltas.get(t)!;
        if (horizontal !== undefined) {
          d[0] = place(horizontal, ref.x, ref.width, t.box.width) - t.box.x;
        }
        if (vertical !== undefined) {
          d[1] = place(vertical, ref.y, ref.height, t.box.height) - t.box.y;
        }
      }
    }

    if (distribute !== undefined) {
      const horizontalAxis = distribute === 'HORIZONTAL';
      const start = (b: Box): number => (horizontalAxis ? b.x : b.y);
      const size = (b: Box): number => (horizontalAxis ? b.width : b.height);
      const ordered = targets.toSorted((a, b) => start(a.box) - start(b.box));
      const first = ordered[0]!;
      const last = ordered.at(-1)!;
      const span = start(last.box) + size(last.box) - start(first.box);
      const used = ordered.reduce((sum, t) => sum + size(t.box), 0);
      const gap = (span - used) / (ordered.length - 1);
      let cursor = start(first.box);
      for (const t of ordered) {
        const d = deltas.get(t)!;
        d[horizontalAxis ? 0 : 1] = cursor - start(t.box);
        cursor += size(t.box) + gap;
      }
    }

    for (const t of targets) {
      const [dx, dy] = deltas.get(t)!;
      if (dx === 0 && dy === 0) continue;
      const [lx, ly] = toParentSpace(t.node.parent, dx, dy);
      const target = t.node as { x: number; y: number };
      target.x += lx;
      target.y += ly;
    }

    const result: BatchNodeResult = { ok: true, affected: [...ids] };
    return result;
  };
