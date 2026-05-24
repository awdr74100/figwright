import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const CREATE_INSTANCE_TOOL_NAME = 'create_instance';

export const createInstanceToolDefinition: Tool = {
  name: CREATE_INSTANCE_TOOL_NAME,
  description:
    'Instantiate a component. Provide componentId (a local COMPONENT node) or componentKey (a ' +
    'published component imported via the API). Optionally name / position / parent the instance. ' +
    'Returns { ok, nodeId, name, type } for the new instance.',
  inputSchema: {
    type: 'object',
    properties: {
      componentId: { type: 'string', description: 'Local component node id to instantiate' },
      componentKey: { type: 'string', description: 'Published component key to instantiate' },
      parentId: { type: 'string', description: 'Container node id; omit for current page' },
      name: { type: 'string', description: 'Optional name for the new instance' },
      x: { type: 'number' },
      y: { type: 'number' },
    },
    required: [],
    additionalProperties: false,
  },
};
