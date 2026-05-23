import type { CreateResult } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

export const createCloneNodeHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown };
    if (typeof p.nodeId !== 'string') throw new TypeError('clone_node: nodeId must be a string');
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || typeof (node as { clone?: unknown }).clone !== 'function') {
      throw new Error(`clone_node: node ${p.nodeId} not found or cannot be cloned`);
    }
    const copy = (node as SceneNode).clone();

    // Place the copy alongside the original (or the current page if the original is detached).
    const parent = (node as SceneNode).parent;
    if (parent !== null && 'appendChild' in parent) {
      (parent as ChildrenMixin).appendChild(copy);
    } else {
      figmaCtx.currentPage.appendChild(copy);
    }

    const result: CreateResult = { ok: true, nodeId: copy.id, name: copy.name, type: copy.type };
    return result;
  };
