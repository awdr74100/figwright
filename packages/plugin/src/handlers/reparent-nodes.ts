import type { BatchNodeResult } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/** Move nodes into a new parent (optionally at a given index). Invalid nodes are skipped. */
export const createReparentNodesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeIds?: unknown; newParentId?: unknown; index?: unknown };
    if (!Array.isArray(p.nodeIds) || p.nodeIds.some(id => typeof id !== 'string')) {
      throw new TypeError('reparent_nodes: nodeIds must be a string[]');
    }
    if (typeof p.newParentId !== 'string') {
      throw new TypeError('reparent_nodes: newParentId must be a string');
    }
    const parent = await figmaCtx.getNodeByIdAsync(p.newParentId);
    if (parent === null || !('appendChild' in parent)) {
      throw new Error(`reparent_nodes: parent ${p.newParentId} not found or cannot contain children`);
    }
    const pm = parent as ChildrenMixin;
    const ids = p.nodeIds as readonly string[];
    const nodes = await Promise.all(ids.map(id => figmaCtx.getNodeByIdAsync(id)));
    const index = typeof p.index === 'number' ? p.index : undefined;

    const affected: string[] = [];
    nodes.forEach((node, i) => {
      if (node === null || !('parent' in node)) return;
      const child = node as SceneNode;
      if (index === undefined) pm.appendChild(child);
      else pm.insertChild(index, child);
      affected.push(ids[i]!);
    });

    const result: BatchNodeResult = { ok: true, affected };
    return result;
  };
