import type { BatchNodeResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/** Translate nodes by (dx, dy). Nodes without x/y (e.g. the page) are skipped. */
export const createMoveNodesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeIds?: unknown; dx?: unknown; dy?: unknown };
    if (!Array.isArray(p.nodeIds) || p.nodeIds.some(id => typeof id !== 'string')) {
      throw new TypeError('move_nodes: nodeIds must be a string[]');
    }
    const dx = typeof p.dx === 'number' ? p.dx : 0;
    const dy = typeof p.dy === 'number' ? p.dy : 0;
    const ids = p.nodeIds as readonly string[];
    const nodes = await Promise.all(ids.map(id => figmaCtx.getNodeByIdAsync(id)));

    const affected: string[] = [];
    nodes.forEach((node, i) => {
      if (node === null || !('x' in node) || !('y' in node)) return;
      const target = node as { x: number; y: number };
      target.x += dx;
      target.y += dy;
      affected.push(ids[i]!);
    });

    const result: BatchNodeResult = { ok: true, affected };
    return result;
  };
