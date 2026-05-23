import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const SET_OPACITY_TOOL_NAME = 'set_opacity';

export const setOpacityToolDefinition: Tool = {
  name: SET_OPACITY_TOOL_NAME,
  description: "Set a node's opacity (0–1). Returns { ok, nodeId }.",
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Figma node id' },
      opacity: { type: 'number', minimum: 0, maximum: 1, description: 'Opacity 0–1' },
    },
    required: ['nodeId', 'opacity'],
    additionalProperties: false,
  },
};
