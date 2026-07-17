import type { MutateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { assertFigmaEditor, isMotionNode } from './motion-shared.js';

/** Set a Motion timeline's duration (seconds, > 0). timelineId comes from get_node_motion. */
export const createSetTimelineDurationHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown; timelineId?: unknown; duration?: unknown };
    if (typeof p.nodeId !== 'string') {
      throw new TypeError('set_timeline_duration: nodeId must be a string');
    }
    if (typeof p.timelineId !== 'string') {
      throw new TypeError('set_timeline_duration: timelineId must be a string');
    }
    if (typeof p.duration !== 'number' || !(p.duration > 0)) {
      throw new TypeError('set_timeline_duration: duration must be a positive number (seconds)');
    }
    assertFigmaEditor(figmaCtx, 'set_timeline_duration');
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !isMotionNode(node)) {
      throw new Error(
        `set_timeline_duration: node ${p.nodeId} not found or does not support Motion`,
      );
    }
    node.setTimelineDuration(p.timelineId, p.duration);
    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
