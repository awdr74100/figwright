import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const CREATE_COMPONENT_TOOL_NAME = 'create_component';

export const createComponentToolDefinition: Tool = {
  name: CREATE_COMPONENT_TOOL_NAME,
  description:
    'Create an empty component (a reusable main component), optionally sized / named / positioned ' +
    'and placed under a parent (default: current page). Returns { ok, nodeId, name, type }.',
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
