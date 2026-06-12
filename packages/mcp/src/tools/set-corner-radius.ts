import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_CORNER_RADIUS_TOOL_NAME = 'set_corner_radius';

export const setCornerRadiusTool: ToolSpec = {
  name: SET_CORNER_RADIUS_TOOL_NAME,
  description:
    "Set a node's corner radius. Pass radius for a uniform radius, and/or per-corner " +
    'topLeftRadius / topRightRadius / bottomRightRadius / bottomLeftRadius (for nodes that support ' +
    'individual corners, e.g. a card rounded only on top, a tab or a chat bubble). A per-corner ' +
    'value overrides radius for that corner. At least one of radius or a corner is required. ' +
    'Returns { ok, nodeId }.',
  inputShape: {
    nodeId: z.string().describe('Figma node id'),
    radius: z.number().min(0).optional().describe('Uniform corner radius in px'),
    topLeftRadius: z.number().min(0).optional().describe('Top-left corner radius in px'),
    topRightRadius: z.number().min(0).optional().describe('Top-right corner radius in px'),
    bottomRightRadius: z.number().min(0).optional().describe('Bottom-right corner radius in px'),
    bottomLeftRadius: z.number().min(0).optional().describe('Bottom-left corner radius in px'),
  },
  kind: 'write',
};
