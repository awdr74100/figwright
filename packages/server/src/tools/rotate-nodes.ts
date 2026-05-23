import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const ROTATE_NODES_TOOL_NAME = 'rotate_nodes';

export const rotateNodesToolDefinition: Tool = {
  name: ROTATE_NODES_TOOL_NAME,
  description:
    'Set absolute rotation (degrees) on nodes. Nodes without rotation are skipped. Returns { ok, affected }.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeIds: { type: 'array', items: { type: 'string' }, description: 'Node ids to rotate' },
      rotation: { type: 'number', description: 'Rotation in degrees' },
    },
    required: ['nodeIds', 'rotation'],
    additionalProperties: false,
  },
};
