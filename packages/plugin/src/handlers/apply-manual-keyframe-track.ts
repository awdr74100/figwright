import type { KeyframeTrackResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import {
  assertFigmaEditor,
  assertKeyframeField,
  assertMotionAliases,
  isMotionNode,
} from './motion-shared.js';
import {
  assertKeyframeDepthTarget,
  keyframeDepthAdjusted,
  keyframeDepthOf,
} from './set-transform-3d.js';

/**
 * Set a hand-authored keyframe track on a node for one field. `field` / `track` shapes are
 * validated MCP-side (keyframeFieldSchema / manualKeyframeTrackInputSchema); here we add the
 * field's effects semantic check and the easing aliases' variable types, and pass through to the
 * plugin API, which replaces any existing track on that field.
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
    await assertMotionAliases(figmaCtx, 'apply_manual_keyframe_track', { track: p.track });
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !isMotionNode(node)) {
      throw new Error(
        `apply_manual_keyframe_track: node ${p.nodeId} not found or does not support Motion`,
      );
    }
    assertKeyframeDepthTarget(node, p.field, 'apply_manual_keyframe_track');
    const drives = keyframeDepthOf(p.field);
    const before =
      drives === null
        ? null
        : ((node as unknown as Record<string, unknown>)[drives] as Transform3d | Scene3d | null);
    node.applyManualKeyframeTrack(p.field as KeyframeField, p.track as ManualKeyframeTrackInput);
    const result: KeyframeTrackResult = { ok: true, nodeId: node.id };
    const adjusted = drives === null ? undefined : keyframeDepthAdjusted(node, p.field, before);
    if (adjusted !== undefined) result.adjusted = adjusted;
    return result;
  };
