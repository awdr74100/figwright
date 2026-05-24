import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const REORDER_NODES_TOOL_NAME = 'reorder_nodes';

export const reorderNodesToolDefinition: Tool = {
  name: REORDER_NODES_TOOL_NAME,
  description:
    'Reorder nodes within their current parent by inserting each at `index` (0 = bottom of the ' +
    "z-order). Detached nodes are skipped. Returns { ok, affected }.",
  inputSchema: {
    type: 'object',
    properties: {
      nodeIds: { type: 'array', items: { type: 'string' }, description: 'Node ids to reorder' },
      index: { type: 'number', description: 'Target index within the parent' },
    },
    required: ['nodeIds', 'index'],
    additionalProperties: false,
  },
};
