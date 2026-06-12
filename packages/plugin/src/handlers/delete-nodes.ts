import type { BatchNodeResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

export const createDeleteNodesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeIds?: unknown };
    if (!Array.isArray(p.nodeIds) || p.nodeIds.some(id => typeof id !== 'string')) {
      throw new TypeError('delete_nodes: nodeIds must be a string[]');
    }
    const ids = p.nodeIds as readonly string[];
    const nodes = await Promise.all(ids.map(id => figmaCtx.getNodeByIdAsync(id)));

    // Resolve in parallel, then remove sequentially. Missing / already-removed / non-removable
    // nodes are skipped (not in `affected`) rather than failing the whole call.
    const affected: string[] = [];
    nodes.forEach((node, i) => {
      if (node === null || !('remove' in node)) return;
      try {
        (node as { remove: () => void }).remove();
        affected.push(ids[i]!);
      } catch {
        /* node was already removed (e.g. its ancestor was deleted first) */
      }
    });

    const result: BatchNodeResult = { ok: true, affected };
    return result;
  };
