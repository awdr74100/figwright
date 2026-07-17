import type { GetNodeMotionResult, NodeMotion } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { isMotionNode, toPlainJson } from './motion-shared.js';

/**
 * Read a node's Motion state (applied styles, animations, manual keyframe tracks, timelines). Reads
 * don't gate on editorType — a node with no Motion support just returns `motion: null`, which is
 * honest in FigJam / Dev Mode. The deep keyframe structures are cloned to plain JSON.
 */
export const createGetNodeMotionHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const nodeId = (params as { nodeId?: unknown } | null)?.nodeId;
    if (typeof nodeId !== 'string') {
      throw new TypeError('get_node_motion: nodeId must be a string');
    }
    const node = await figmaCtx.getNodeByIdAsync(nodeId);
    if (node === null || !isMotionNode(node)) {
      const miss: GetNodeMotionResult = { nodeId, motion: null };
      return miss;
    }
    const motion: NodeMotion = {
      animationStyles: toPlainJson(node.animationStyles) as unknown[],
      animations: toPlainJson(node.animations) as Record<string, unknown>,
      manualKeyframeTracks: toPlainJson(node.manualKeyframeTracks) as Record<string, unknown>,
      timelines: node.timelines.map(t => ({ id: t.id, duration: t.duration })),
    };
    const result: GetNodeMotionResult = { nodeId: node.id, motion };
    return result;
  };
