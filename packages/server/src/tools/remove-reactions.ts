import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const REMOVE_REACTIONS_TOOL_NAME = 'remove_reactions';

export const removeReactionsToolDefinition: Tool = {
  name: REMOVE_REACTIONS_TOOL_NAME,
  description: 'Clear all prototype reactions from a node. Returns { ok, nodeId }.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Node to clear reactions from' },
    },
    required: ['nodeId'],
    additionalProperties: false,
  },
};
