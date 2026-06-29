import type { MutateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/**
 * Set a node's parent-relative position (x / y). For a top-level node x/y are canvas coordinates;
 * for an absolutely-positioned child they are relative to its auto-layout parent.
 *
 * An in-flow auto-layout child is positioned by the layout: Figma does NOT throw on an x/y write,
 * it silently reflows the node back — which would make this tool report a misleading success. So we
 * detect that case up front (auto-layout parent + non-ABSOLUTE child) and return an actionable
 * error pointing at layoutPositioning ABSOLUTE, rather than writing a no-op and claiming ok.
 */
export const createSetPositionHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown; x?: unknown; y?: unknown };
    if (typeof p.nodeId !== 'string') throw new TypeError('set_position: nodeId must be a string');
    if (p.x !== undefined && typeof p.x !== 'number')
      throw new TypeError('set_position: x must be a number');
    if (p.y !== undefined && typeof p.y !== 'number')
      throw new TypeError('set_position: y must be a number');

    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null) throw new Error(`set_position: node ${p.nodeId} not found`);
    if (!('x' in node) || !('y' in node)) {
      throw new Error(`set_position: node ${p.nodeId} has no position`);
    }

    const parent = (node as SceneNode).parent;
    const inFlowAutoLayout =
      typeof parent === 'object' &&
      parent !== null &&
      'layoutMode' in parent &&
      (parent as { layoutMode: string }).layoutMode !== 'NONE' &&
      'layoutPositioning' in node &&
      (node as { layoutPositioning: string }).layoutPositioning !== 'ABSOLUTE';
    if (inFlowAutoLayout) {
      throw new Error(
        `set_position: node ${p.nodeId} is an in-flow child of an auto-layout frame — its x/y are ` +
          `controlled by the layout and a write would be silently reflowed away. Set ` +
          `layoutPositioning ABSOLUTE (set_layout_props) first to place it freely.`,
      );
    }

    const target = node as { x: number; y: number };
    if (typeof p.x === 'number') target.x = p.x;
    if (typeof p.y === 'number') target.y = p.y;

    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
