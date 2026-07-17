import type { MutateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { assertFigmaEditor, assertKeyframeField, isMotionNode } from './motion-shared.js';

/** Remove the manual keyframe track for a field on a node. Destructive: the track is discarded. */
export const createRemoveManualKeyframeTrackHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown; field?: unknown };
    if (typeof p.nodeId !== 'string') {
      throw new TypeError('remove_manual_keyframe_track: nodeId must be a string');
    }
    assertKeyframeField(p.field, 'remove_manual_keyframe_track');
    assertFigmaEditor(figmaCtx, 'remove_manual_keyframe_track');
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !isMotionNode(node)) {
      throw new Error(
        `remove_manual_keyframe_track: node ${p.nodeId} not found or does not support Motion`,
      );
    }
    node.removeManualKeyframeTrack(p.field as KeyframeField);
    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
