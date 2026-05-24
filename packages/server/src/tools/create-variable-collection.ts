import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const CREATE_VARIABLE_COLLECTION_TOOL_NAME = 'create_variable_collection';

export const createVariableCollectionToolDefinition: Tool = {
  name: CREATE_VARIABLE_COLLECTION_TOOL_NAME,
  description:
    'Create a variable collection. Figma auto-creates a default mode. ' +
    'Returns { ok, collectionId, defaultModeId, name }.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Collection name, e.g. "Theme"' },
    },
    required: ['name'],
    additionalProperties: false,
  },
};
