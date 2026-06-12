import type { BatchNodeResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/** Set absolute rotation (degrees) on each node. Nodes without rotation are skipped. */
export const createRotateNodesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeIds?: unknown; rotation?: unknown };
    if (!Array.isArray(p.nodeIds) || p.nodeIds.some(id => typeof id !== 'string')) {
      throw new TypeError('rotate_nodes: nodeIds must be a string[]');
    }
    if (typeof p.rotation !== 'number')
      throw new TypeError('rotate_nodes: rotation must be a number');
    const { rotation } = p;
    const ids = p.nodeIds as readonly string[];
    const nodes = await Promise.all(ids.map(id => figmaCtx.getNodeByIdAsync(id)));

    const affected: string[] = [];
    nodes.forEach((node, i) => {
      if (node === null || !('rotation' in node)) return;
      (node as { rotation: number }).rotation = rotation;
      affected.push(ids[i]!);
    });

    const result: BatchNodeResult = { ok: true, affected };
    return result;
  };
