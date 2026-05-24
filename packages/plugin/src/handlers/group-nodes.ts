import type { CreateResult } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/** Group nodes under their (shared) parent. Returns the new group's id / name / type. */
export const createGroupNodesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeIds?: unknown; name?: unknown };
    if (
      !Array.isArray(p.nodeIds) ||
      p.nodeIds.length === 0 ||
      p.nodeIds.some(id => typeof id !== 'string')
    ) {
      throw new TypeError('group_nodes: nodeIds must be a non-empty string[]');
    }
    const ids = p.nodeIds as readonly string[];
    const resolved = await Promise.all(ids.map(id => figmaCtx.getNodeByIdAsync(id)));
    const nodes = resolved.filter((n): n is SceneNode => n !== null && 'parent' in n);
    if (nodes.length === 0) throw new Error('group_nodes: no valid nodes to group');

    const parent = nodes[0]!.parent;
    if (parent === null || !('appendChild' in parent)) {
      throw new Error('group_nodes: nodes have no groupable parent');
    }
    const group = figmaCtx.group(nodes, parent as BaseNode & ChildrenMixin);
    if (typeof p.name === 'string') group.name = p.name;

    const result: CreateResult = { ok: true, nodeId: group.id, name: group.name, type: group.type };
    return result;
  };
