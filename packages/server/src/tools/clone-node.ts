import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const CLONE_NODE_TOOL_NAME = 'clone_node';

export const cloneNodeToolDefinition: Tool = {
  name: CLONE_NODE_TOOL_NAME,
  description:
    'Duplicate a node next to the original (same parent). Returns { ok, nodeId, name, type } for the copy.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Node id to clone' },
    },
    required: ['nodeId'],
    additionalProperties: false,
  },
};
