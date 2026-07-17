import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const GET_NODE_MOTION_TOOL_NAME = 'get_node_motion';

export const getNodeMotionTool: ToolSpec = {
  name: GET_NODE_MOTION_TOOL_NAME,
  description:
    "Read a node's Figma Motion (animation) state: applied animation styles, all keyframe animations, " +
    'manual keyframe tracks, and the timelines it belongs to. Call it before editing to discover ' +
    'styleIds / timelineIds and existing keyframes. Returns { nodeId, animationStyles, animations, ' +
    'manualKeyframeTracks, timelines }, or { nodeId, motion: null } when the node supports no Motion.',
  inputShape: {
    nodeId: z.string().describe('Figma node id to read Motion state from'),
  },
  kind: 'read',
};
