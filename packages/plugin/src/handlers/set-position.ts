import type { MutateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/**
 * Set a node's parent-relative position (x / y). For a top-level node x/y are canvas coordinates;
 * for an absolutely-positioned child they are relative to its auto-layout parent. Figma controls
 * the x/y of an in-flow auto-layout child, so setting those throws — surface an actionable hint
 * (set layoutPositioning ABSOLUTE first) instead of a raw exception.
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
    const target = node as { x: number; y: number };
    try {
      if (typeof p.x === 'number') target.x = p.x;
      if (typeof p.y === 'number') target.y = p.y;
    } catch (err) {
      throw new Error(
        `set_position: cannot set x/y on node ${p.nodeId} — a node in-flow inside an auto-layout ` +
          `frame is positioned by the layout; set layoutPositioning ABSOLUTE first to place it freely`,
        { cause: err },
      );
    }

    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
