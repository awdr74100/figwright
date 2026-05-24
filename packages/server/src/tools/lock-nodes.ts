import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const LOCK_NODES_TOOL_NAME = 'lock_nodes';

export const lockNodesToolDefinition: Tool = {
  name: LOCK_NODES_TOOL_NAME,
  description: 'Lock nodes (prevent selection/editing on canvas). Returns { ok, affected }.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeIds: { type: 'array', items: { type: 'string' }, description: 'Node ids to lock' },
    },
    required: ['nodeIds'],
    additionalProperties: false,
  },
};
