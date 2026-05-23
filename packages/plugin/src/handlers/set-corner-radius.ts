import type { MutateResult } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

export const createSetCornerRadiusHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown; radius?: unknown };
    if (typeof p.nodeId !== 'string') throw new TypeError('set_corner_radius: nodeId must be a string');
    if (typeof p.radius !== 'number' || p.radius < 0) {
      throw new TypeError('set_corner_radius: radius must be a non-negative number');
    }
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !('cornerRadius' in node)) {
      throw new Error(`set_corner_radius: node ${p.nodeId} not found or has no cornerRadius`);
    }
    (node as { cornerRadius: number }).cornerRadius = p.radius;
    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
