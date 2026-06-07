import type { CreateResult } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/**
 * Combine existing COMPONENT nodes into a COMPONENT_SET via figma.combineAsVariants. The parent
 * defaults to the first component's current parent; the components are reparented into the new
 * set.
 */
export const createCombineAsVariantsHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeIds?: unknown; parentId?: unknown; name?: unknown };
    if (!Array.isArray(p.nodeIds) || p.nodeIds.length < 2) {
      throw new TypeError('combine_as_variants: nodeIds must be an array of at least 2 ids');
    }

    const nodes = await Promise.all(
      (p.nodeIds as string[]).map(id => figmaCtx.getNodeByIdAsync(id)),
    );
    const components: ComponentNode[] = [];
    for (const [i, node] of nodes.entries()) {
      if (node === null) throw new Error(`combine_as_variants: node ${p.nodeIds[i]} not found`);
      if (node.type !== 'COMPONENT') {
        throw new Error(
          `combine_as_variants: node ${p.nodeIds[i]} is a ${node.type}, not a COMPONENT`,
        );
      }
      components.push(node as ComponentNode);
    }

    // Parent: explicit parentId, else the first component's current parent.
    let parent: (BaseNode & ChildrenMixin) | null;
    if (typeof p.parentId === 'string') {
      const candidate = await figmaCtx.getNodeByIdAsync(p.parentId);
      if (candidate === null || !('appendChild' in candidate)) {
        throw new Error(
          `combine_as_variants: parent ${p.parentId} not found or cannot contain children`,
        );
      }
      parent = candidate as BaseNode & ChildrenMixin;
    } else {
      parent = components[0]!.parent as (BaseNode & ChildrenMixin) | null;
      if (parent === null) {
        throw new Error('combine_as_variants: first component has no parent; pass parentId');
      }
    }

    const set = figmaCtx.combineAsVariants(components, parent);
    if (typeof p.name === 'string') set.name = p.name;

    const result: CreateResult = { ok: true, nodeId: set.id, name: set.name, type: set.type };
    return result;
  };
