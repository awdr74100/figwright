import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const REPARENT_NODES_TOOL_NAME = 'reparent_nodes';

export const reparentNodesToolDefinition: Tool = {
  name: REPARENT_NODES_TOOL_NAME,
  description:
    'Move nodes into a new parent (optionally at `index`). Nodes that no longer exist are skipped. ' +
    'Returns { ok, affected }.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeIds: { type: 'array', items: { type: 'string' }, description: 'Node ids to move' },
      newParentId: { type: 'string', description: 'Id of the parent to move them into' },
      index: { type: 'number', description: 'Optional insertion index within the new parent' },
    },
    required: ['nodeIds', 'newParentId'],
    additionalProperties: false,
  },
};
