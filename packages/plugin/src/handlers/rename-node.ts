import type { MutateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

export const createRenameNodeHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown; name?: unknown };
    if (typeof p.nodeId !== 'string') throw new TypeError('rename_node: nodeId must be a string');
    if (typeof p.name !== 'string' || p.name.length === 0) {
      throw new TypeError('rename_node: name must be a non-empty string');
    }
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null) throw new Error(`rename_node: node ${p.nodeId} not found`);
    node.name = p.name;
    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
