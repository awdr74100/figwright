import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const SET_VISIBLE_TOOL_NAME = 'set_visible';

export const setVisibleToolDefinition: Tool = {
  name: SET_VISIBLE_TOOL_NAME,
  description: "Show or hide a node. Returns { ok, nodeId }.",
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Figma node id' },
      visible: { type: 'boolean', description: 'true to show, false to hide' },
    },
    required: ['nodeId', 'visible'],
    additionalProperties: false,
  },
};
