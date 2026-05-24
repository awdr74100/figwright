import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const MOVE_NODES_TOOL_NAME = 'move_nodes';

export const moveNodesToolDefinition: Tool = {
  name: MOVE_NODES_TOOL_NAME,
  description:
    'Translate nodes by (dx, dy). Nodes without a position are skipped. Returns { ok, affected }.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeIds: { type: 'array', items: { type: 'string' }, description: 'Node ids to move' },
      dx: { type: 'number', description: 'Horizontal delta (default 0)' },
      dy: { type: 'number', description: 'Vertical delta (default 0)' },
    },
    required: ['nodeIds'],
    additionalProperties: false,
  },
};
