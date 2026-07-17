import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_TIMELINE_DURATION_TOOL_NAME = 'set_timeline_duration';

export const setTimelineDurationTool: ToolSpec = {
  name: SET_TIMELINE_DURATION_TOOL_NAME,
  description:
    'Set the duration (in seconds, must be > 0) of a Figma Motion timeline. Get the timelineId from ' +
    "get_node_motion (a node's `timelines`). Returns { ok, nodeId }.",
  inputShape: {
    nodeId: z.string().describe('A node on the timeline (used to resolve the Motion API)'),
    timelineId: z.string().describe('Timeline id from get_node_motion'),
    duration: z.number().positive().describe('New timeline duration in seconds (> 0)'),
  },
  kind: 'write',
};
