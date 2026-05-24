import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const CREATE_ELLIPSE_TOOL_NAME = 'create_ellipse';

export const createEllipseToolDefinition: Tool = {
  name: CREATE_ELLIPSE_TOOL_NAME,
  description:
    'Create an ellipse, optionally sized / named / positioned and placed under a parent (default: ' +
    'current page). Returns { ok, nodeId, name, type }.',
  inputSchema: {
    type: 'object',
    properties: {
      parentId: { type: 'string', description: 'Parent node id (default: current page)' },
      name: { type: 'string' },
      x: { type: 'number' },
      y: { type: 'number' },
      width: { type: 'number' },
      height: { type: 'number' },
    },
    additionalProperties: false,
  },
};
