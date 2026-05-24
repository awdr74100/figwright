import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const GROUP_NODES_TOOL_NAME = 'group_nodes';

export const groupNodesToolDefinition: Tool = {
  name: GROUP_NODES_TOOL_NAME,
  description:
    'Group nodes under their shared parent. nodeIds must be a non-empty list. ' +
    'Returns { ok, nodeId, name, type } for the new group.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeIds: { type: 'array', items: { type: 'string' }, description: 'Node ids to group' },
      name: { type: 'string', description: 'Optional name for the new group' },
    },
    required: ['nodeIds'],
    additionalProperties: false,
  },
};
