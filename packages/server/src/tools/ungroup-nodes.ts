import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const UNGROUP_NODES_TOOL_NAME = 'ungroup_nodes';

export const ungroupNodesToolDefinition: Tool = {
  name: UNGROUP_NODES_TOOL_NAME,
  description:
    'Ungroup GROUP nodes by id; non-group nodes are skipped. ' +
    'Returns { ok, affected } — the ids of the children promoted out of the groups.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeIds: { type: 'array', items: { type: 'string' }, description: 'Group node ids to ungroup' },
    },
    required: ['nodeIds'],
    additionalProperties: false,
  },
};
