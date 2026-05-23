import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const SET_BLEND_MODE_TOOL_NAME = 'set_blend_mode';

export const setBlendModeToolDefinition: Tool = {
  name: SET_BLEND_MODE_TOOL_NAME,
  description: "Set a node's blend mode (e.g. NORMAL, MULTIPLY, SCREEN, OVERLAY). Returns { ok, nodeId }.",
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string' },
      blendMode: { type: 'string', description: 'Figma blend mode literal' },
    },
    required: ['nodeId', 'blendMode'],
    additionalProperties: false,
  },
};
