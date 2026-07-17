import type { ApplyAnimationStyleResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { assertFigmaEditor, isMotionNode } from './motion-shared.js';

/**
 * Apply a Motion animation-style preset to a node. Returns the appliedStyleId Figma hands back —
 * the batch inverse removes exactly this instance on undo, so it must round-trip. `config` shape is
 * validated MCP-side (animationStyleConfigSchema); here we pass it through to the plugin API.
 */
export const createApplyAnimationStyleHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown; styleId?: unknown; config?: unknown };
    if (typeof p.nodeId !== 'string') {
      throw new TypeError('apply_animation_style: nodeId must be a string');
    }
    if (typeof p.styleId !== 'string') {
      throw new TypeError('apply_animation_style: styleId must be a string');
    }
    if (p.config !== undefined && (typeof p.config !== 'object' || p.config === null)) {
      throw new TypeError('apply_animation_style: config must be an object');
    }
    assertFigmaEditor(figmaCtx, 'apply_animation_style');
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !isMotionNode(node)) {
      throw new Error(
        `apply_animation_style: node ${p.nodeId} not found or does not support Motion`,
      );
    }
    const appliedStyleId = node.applyAnimationStyle(
      p.styleId,
      p.config as AnimationStyleConfiguration | undefined,
    );
    const result: ApplyAnimationStyleResult = { ok: true, nodeId: node.id, appliedStyleId };
    return result;
  };
