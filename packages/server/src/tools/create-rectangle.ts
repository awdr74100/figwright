import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const CREATE_RECTANGLE_TOOL_NAME = 'create_rectangle';

export const createRectangleToolDefinition: Tool = {
  name: CREATE_RECTANGLE_TOOL_NAME,
  description:
    'Create a rectangle, optionally sized/positioned and appended to a parent (else the current page). ' +
    'Returns { ok, nodeId, name, type }.',
  inputSchema: {
    type: 'object',
    properties: {
      parentId: { type: 'string', description: 'Container node id; omit for current page' },
      name: { type: 'string' },
      x: { type: 'number' },
      y: { type: 'number' },
      width: { type: 'number' },
      height: { type: 'number' },
    },
    required: [],
    additionalProperties: false,
  },
};
