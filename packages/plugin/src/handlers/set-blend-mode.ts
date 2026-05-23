import type { MutateResult } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

export const createSetBlendModeHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown; blendMode?: unknown };
    if (typeof p.nodeId !== 'string') throw new TypeError('set_blend_mode: nodeId must be a string');
    if (typeof p.blendMode !== 'string') throw new TypeError('set_blend_mode: blendMode must be a string');
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !('blendMode' in node)) {
      throw new Error(`set_blend_mode: node ${p.nodeId} not found or has no blendMode`);
    }
    (node as { blendMode: BlendMode }).blendMode = p.blendMode as BlendMode;
    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
