import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const ADD_VARIABLE_MODE_TOOL_NAME = 'add_variable_mode';

export const addVariableModeToolDefinition: Tool = {
  name: ADD_VARIABLE_MODE_TOOL_NAME,
  description:
    'Add a mode (e.g. "Dark") to a variable collection. Returns { ok, modeId, name }.',
  inputSchema: {
    type: 'object',
    properties: {
      collectionId: { type: 'string', description: 'Variable collection id' },
      name: { type: 'string', description: 'Mode name, e.g. "Dark"' },
    },
    required: ['collectionId', 'name'],
    additionalProperties: false,
  },
};
