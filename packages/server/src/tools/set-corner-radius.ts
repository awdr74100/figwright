import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const SET_CORNER_RADIUS_TOOL_NAME = 'set_corner_radius';

export const setCornerRadiusToolDefinition: Tool = {
  name: SET_CORNER_RADIUS_TOOL_NAME,
  description: "Set a node's uniform corner radius (≥ 0). Returns { ok, nodeId }.",
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Figma node id' },
      radius: { type: 'number', minimum: 0, description: 'Corner radius in px' },
    },
    required: ['nodeId', 'radius'],
    additionalProperties: false,
  },
};
