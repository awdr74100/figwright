import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const RENAME_NODE_TOOL_NAME = 'rename_node';

export const renameNodeToolDefinition: Tool = {
  name: RENAME_NODE_TOOL_NAME,
  description: "Rename a node. Returns { ok, nodeId }.",
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Figma node id' },
      name: { type: 'string', description: 'New layer name' },
    },
    required: ['nodeId', 'name'],
    additionalProperties: false,
  },
};
