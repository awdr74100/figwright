import type { BatchNodeResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/** Reorder nodes within their current parent by inserting each at `index`. Detached nodes skipped. */
export const createReorderNodesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeIds?: unknown; index?: unknown };
    if (!Array.isArray(p.nodeIds) || p.nodeIds.some(id => typeof id !== 'string')) {
      throw new TypeError('reorder_nodes: nodeIds must be a string[]');
    }
    if (typeof p.index !== 'number') throw new TypeError('reorder_nodes: index must be a number');
    const ids = p.nodeIds as readonly string[];
    const nodes = await Promise.all(ids.map(id => figmaCtx.getNodeByIdAsync(id)));

    const affected: string[] = [];
    nodes.forEach((node, i) => {
      if (node === null || !('parent' in node)) return;
      const child = node as SceneNode;
      const parent = child.parent;
      if (parent === null || !('insertChild' in parent)) return;
      (parent as ChildrenMixin).insertChild(p.index as number, child);
      affected.push(ids[i]!);
    });

    const result: BatchNodeResult = { ok: true, affected };
    return result;
  };
