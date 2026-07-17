import type { MutateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { assertFigmaEditor, assertKeyframeField, isMotionNode } from './motion-shared.js';

/**
 * Set a hand-authored keyframe track on a node for one field. `field` / `track` shapes are
 * validated MCP-side (keyframeFieldSchema / manualKeyframeTrackInputSchema); here we add the
 * field's effects semantic check and pass through to the plugin API, which replaces any existing
 * track on that field.
 */
export const createApplyManualKeyframeTrackHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown; field?: unknown; track?: unknown };
    if (typeof p.nodeId !== 'string') {
      throw new TypeError('apply_manual_keyframe_track: nodeId must be a string');
    }
    assertKeyframeField(p.field, 'apply_manual_keyframe_track');
    if (typeof p.track !== 'object' || p.track === null) {
      throw new TypeError('apply_manual_keyframe_track: track must be an object');
    }
    assertFigmaEditor(figmaCtx, 'apply_manual_keyframe_track');
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !isMotionNode(node)) {
      throw new Error(
        `apply_manual_keyframe_track: node ${p.nodeId} not found or does not support Motion`,
      );
    }
    node.applyManualKeyframeTrack(p.field as KeyframeField, p.track as ManualKeyframeTrackInput);
    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
