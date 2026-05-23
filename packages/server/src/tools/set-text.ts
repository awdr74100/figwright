import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const SET_TEXT_TOOL_NAME = 'set_text';

export const setTextToolDefinition: Tool = {
  name: SET_TEXT_TOOL_NAME,
  description:
    "Replace a TEXT node's characters. The plugin loads the node's fonts first. Returns { ok, nodeId }.",
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'TEXT node id to update' },
      characters: { type: 'string', description: 'New text content' },
    },
    required: ['nodeId', 'characters'],
    additionalProperties: false,
  },
};
