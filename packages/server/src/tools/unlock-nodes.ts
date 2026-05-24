import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const UNLOCK_NODES_TOOL_NAME = 'unlock_nodes';

export const unlockNodesToolDefinition: Tool = {
  name: UNLOCK_NODES_TOOL_NAME,
  description: 'Unlock nodes. Returns { ok, affected }.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeIds: { type: 'array', items: { type: 'string' }, description: 'Node ids to unlock' },
    },
    required: ['nodeIds'],
    additionalProperties: false,
  },
};
