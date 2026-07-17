import type { MutateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { assertFigmaEditor, isMotionNode } from './motion-shared.js';

/**
 * Remove one applied Motion animation style (by its appliedStyleId), or all of them when no id is
 * given. Destructive: severing an applied style can't be reconstructed without re-applying.
 */
export const createRemoveAnimationStyleHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown; animationStyleId?: unknown };
    if (typeof p.nodeId !== 'string') {
      throw new TypeError('remove_animation_style: nodeId must be a string');
    }
    if (p.animationStyleId !== undefined && typeof p.animationStyleId !== 'string') {
      throw new TypeError('remove_animation_style: animationStyleId must be a string');
    }
    assertFigmaEditor(figmaCtx, 'remove_animation_style');
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !isMotionNode(node)) {
      throw new Error(
        `remove_animation_style: node ${p.nodeId} not found or does not support Motion`,
      );
    }
    if (typeof p.animationStyleId === 'string') {
      node.removeAnimationStyle(p.animationStyleId);
    } else {
      // Snapshot ids first — removing mutates the live animationStyles list.
      const appliedIds = node.animationStyles.map(applied => applied.id);
      for (const id of appliedIds) node.removeAnimationStyle(id);
    }
    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
