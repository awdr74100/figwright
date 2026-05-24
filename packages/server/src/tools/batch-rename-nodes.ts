import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const BATCH_RENAME_NODES_TOOL_NAME = 'batch_rename_nodes';

export const batchRenameNodesToolDefinition: Tool = {
  name: BATCH_RENAME_NODES_TOOL_NAME,
  description:
    'Rename many nodes at once from a [{ nodeId, name }] list. Missing nodes are skipped. ' +
    'Returns { ok, affected }.',
  inputSchema: {
    type: 'object',
    properties: {
      renames: {
        type: 'array',
        description: 'Per-node rename instructions',
        items: {
          type: 'object',
          properties: {
            nodeId: { type: 'string' },
            name: { type: 'string' },
          },
          required: ['nodeId', 'name'],
        },
      },
    },
    required: ['renames'],
    additionalProperties: false,
  },
};
