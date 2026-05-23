import type { MutateResult } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

export const createSetVisibleHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown; visible?: unknown };
    if (typeof p.nodeId !== 'string') throw new TypeError('set_visible: nodeId must be a string');
    if (typeof p.visible !== 'boolean') throw new TypeError('set_visible: visible must be a boolean');
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !('visible' in node)) {
      throw new Error(`set_visible: node ${p.nodeId} not found or cannot be hidden`);
    }
    (node as SceneNode).visible = p.visible;
    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
