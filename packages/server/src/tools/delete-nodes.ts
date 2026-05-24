import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const DELETE_NODES_TOOL_NAME = 'delete_nodes';

export const deleteNodesToolDefinition: Tool = {
  name: DELETE_NODES_TOOL_NAME,
  description:
    'Delete nodes by id. Missing / non-removable nodes are skipped. Returns { ok, affected } — the ids actually removed.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeIds: { type: 'array', items: { type: 'string' }, description: 'Node ids to delete' },
    },
    required: ['nodeIds'],
    additionalProperties: false,
  },
};
