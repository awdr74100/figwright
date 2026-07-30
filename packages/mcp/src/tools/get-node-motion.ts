import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const GET_NODE_MOTION_TOOL_NAME = 'get_node_motion';

export const getNodeMotionTool: ToolSpec = {
  name: GET_NODE_MOTION_TOOL_NAME,
  description:
    "Read a node's Figma Motion (animation) state: applied animation styles, all keyframe animations, " +
    'manual keyframe tracks, and the timelines it belongs to. Call it before editing to discover ' +
    'styleIds / timelineIds and existing keyframes. Returns { nodeId, motion: { animationStyles, ' +
    'animations, manualKeyframeTracks, timelines } }, with motion: null when the node supports no ' +
    "Motion. Also returns playheadPosition — the editor's Motion playhead in seconds, present only " +
    'in the Figma Design editor with an active timeline. Use it as a keyframe timelinePosition when ' +
    'the user means "here", i.e. wherever they have scrubbed to.',
  inputShape: {
    nodeId: z.string().describe('Figma node id to read Motion state from'),
  },
  kind: 'read',
};
