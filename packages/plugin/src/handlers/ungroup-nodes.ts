import type { BatchNodeResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/** Ungroup GROUP nodes; non-groups are skipped. Returns the ids of the children promoted out. */
export const createUngroupNodesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeIds?: unknown };
    if (!Array.isArray(p.nodeIds) || p.nodeIds.some(id => typeof id !== 'string')) {
      throw new TypeError('ungroup_nodes: nodeIds must be a string[]');
    }
    const ids = p.nodeIds as readonly string[];
    const nodes = await Promise.all(ids.map(id => figmaCtx.getNodeByIdAsync(id)));

    const affected: string[] = [];
    for (const node of nodes) {
      if (node === null || node.type !== 'GROUP') continue;
      const children = figmaCtx.ungroup(node as GroupNode);
      for (const child of children) affected.push(child.id);
    }

    const result: BatchNodeResult = { ok: true, affected };
    return result;
  };
