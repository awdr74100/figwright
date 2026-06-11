import type { MutateResult } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

export const createSetMaskHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown; isMask?: unknown; maskType?: unknown };
    if (typeof p.nodeId !== 'string') throw new TypeError('set_mask: nodeId must be a string');
    if (typeof p.isMask !== 'boolean') throw new TypeError('set_mask: isMask must be a boolean');
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !('isMask' in node)) {
      throw new Error(`set_mask: node ${p.nodeId} not found or cannot be a mask`);
    }
    (node as { isMask: boolean }).isMask = p.isMask;
    // maskType only matters while masking; set it when enabling and the node exposes it.
    if (p.isMask && typeof p.maskType === 'string' && 'maskType' in node) {
      (node as { maskType: MaskType }).maskType = p.maskType as MaskType;
    }
    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
