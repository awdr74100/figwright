import type { MutateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

type SizingAxis = 'layoutSizingHorizontal' | 'layoutSizingVertical';

const SIZE_BOUNDS = ['minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const;
type SizeBound = (typeof SIZE_BOUNDS)[number];

/**
 * Apply a HUG / FILL / FIXED sizing value to one axis. Figma throws when the context is wrong (HUG
 * needs an auto-layout frame or text node; FILL needs an auto-layout parent) — turn that into an
 * actionable message instead of a raw plugin exception.
 */
const setSizing = (
  node: Partial<Record<SizingAxis, string>>,
  axis: SizingAxis,
  value: unknown,
  nodeId: string,
): void => {
  if (typeof value !== 'string') return;
  if (!(axis in node)) throw new Error(`set_layout_props: node ${nodeId} does not support ${axis}`);
  try {
    node[axis] = value;
  } catch (err) {
    throw new Error(
      `set_layout_props: cannot set ${axis}=${value} on node ${nodeId} — HUG needs an auto-layout ` +
        `frame or text node, FILL needs an auto-layout parent`,
      { cause: err },
    );
  }
};

/**
 * Set a node's auto-layout sizing and child properties. layoutSizingHorizontal/Vertical (HUG / FILL
 * / FIXED) size a frame to its content or make a child fill its parent; layoutAlign / layoutGrow /
 * layoutPositioning are the older per-axis child properties. Figma exposes layoutAlign on any
 * SceneNode, so we set whatever is provided and leave the rest unchanged. Sizing is applied last so
 * it wins over layoutAlign/layoutGrow when both are given.
 */
export const createSetLayoutPropsHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      nodeId?: unknown;
      layoutSizingHorizontal?: unknown;
      layoutSizingVertical?: unknown;
      layoutAlign?: unknown;
      layoutGrow?: unknown;
      layoutPositioning?: unknown;
      minWidth?: unknown;
      maxWidth?: unknown;
      minHeight?: unknown;
      maxHeight?: unknown;
    };
    if (typeof p.nodeId !== 'string')
      throw new TypeError('set_layout_props: nodeId must be a string');
    if (p.layoutGrow !== undefined && (typeof p.layoutGrow !== 'number' || p.layoutGrow < 0)) {
      throw new TypeError('set_layout_props: layoutGrow must be a non-negative number');
    }
    for (const bound of SIZE_BOUNDS) {
      const v = p[bound];
      if (v !== undefined && v !== null && (typeof v !== 'number' || v <= 0)) {
        throw new TypeError(`set_layout_props: ${bound} must be a positive number or null`);
      }
    }

    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null) throw new Error(`set_layout_props: node ${p.nodeId} not found`);
    if (!('layoutAlign' in node)) {
      throw new Error(`set_layout_props: node ${p.nodeId} has no auto-layout child properties`);
    }
    const n = node as SceneNode & {
      layoutAlign: string;
      layoutGrow: number;
      layoutPositioning: string;
      layoutSizingHorizontal?: string;
      layoutSizingVertical?: string;
    };

    if (typeof p.layoutAlign === 'string') n.layoutAlign = p.layoutAlign;
    if (typeof p.layoutGrow === 'number') n.layoutGrow = p.layoutGrow;
    if (typeof p.layoutPositioning === 'string') n.layoutPositioning = p.layoutPositioning;
    setSizing(n, 'layoutSizingHorizontal', p.layoutSizingHorizontal, p.nodeId);
    setSizing(n, 'layoutSizingVertical', p.layoutSizingVertical, p.nodeId);

    // Min/max size bounds (null clears). Figma throws outside the supported context (an
    // auto-layout frame or its direct child) — translate to an actionable message.
    const bounds = node as Partial<Record<SizeBound, number | null>>;
    for (const bound of SIZE_BOUNDS) {
      const v = p[bound];
      if (v === undefined) continue;
      if (!(bound in node)) {
        throw new Error(`set_layout_props: node ${p.nodeId} does not support ${bound}`);
      }
      try {
        bounds[bound] = v as number | null;
      } catch (err) {
        throw new Error(
          `set_layout_props: cannot set ${bound} on node ${p.nodeId} — min/max bounds apply to ` +
            `auto-layout frames and their direct children`,
          { cause: err },
        );
      }
    }

    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
