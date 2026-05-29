import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_CORNER_RADIUS_TOOL_NAME = 'set_corner_radius';

export const setCornerRadiusTool: ToolSpec = {
  name: SET_CORNER_RADIUS_TOOL_NAME,
  description: "Set a node's uniform corner radius (≥ 0). Returns { ok, nodeId }.",
  inputShape: {
    nodeId: z.string().describe('Figma node id'),
    radius: z.number().min(0).describe('Corner radius in px'),
  },
  kind: 'write',
};
