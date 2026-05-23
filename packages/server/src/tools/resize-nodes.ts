import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const RESIZE_NODES_TOOL_NAME = 'resize_nodes';

export const resizeNodesToolDefinition: Tool = {
  name: RESIZE_NODES_TOOL_NAME,
  description:
    'Resize nodes to the given width × height (positive). Non-resizable nodes are skipped. Returns { ok, affected }.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeIds: { type: 'array', items: { type: 'string' }, description: 'Node ids to resize' },
      width: { type: 'number', exclusiveMinimum: 0 },
      height: { type: 'number', exclusiveMinimum: 0 },
    },
    required: ['nodeIds', 'width', 'height'],
    additionalProperties: false,
  },
};
