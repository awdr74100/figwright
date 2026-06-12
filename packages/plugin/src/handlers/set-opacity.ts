import type { MutateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

export const createSetOpacityHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown; opacity?: unknown };
    if (typeof p.nodeId !== 'string') throw new TypeError('set_opacity: nodeId must be a string');
    if (typeof p.opacity !== 'number' || p.opacity < 0 || p.opacity > 1) {
      throw new TypeError('set_opacity: opacity must be a number in 0–1');
    }
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !('opacity' in node)) {
      throw new Error(`set_opacity: node ${p.nodeId} not found or has no opacity`);
    }
    (node as { opacity: number }).opacity = p.opacity;
    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
