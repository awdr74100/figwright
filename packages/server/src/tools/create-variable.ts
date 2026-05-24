import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const CREATE_VARIABLE_TOOL_NAME = 'create_variable';

export const createVariableToolDefinition: Tool = {
  name: CREATE_VARIABLE_TOOL_NAME,
  description:
    'Create a variable in a collection. resolvedType is BOOLEAN / FLOAT / STRING / COLOR. ' +
    'Use set_variable_value to populate per-mode values. Returns { ok, variableId, name }.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Variable name, e.g. "color/primary"' },
      collectionId: { type: 'string', description: 'Variable collection id' },
      resolvedType: { type: 'string', enum: ['BOOLEAN', 'FLOAT', 'STRING', 'COLOR'] },
    },
    required: ['name', 'collectionId', 'resolvedType'],
    additionalProperties: false,
  },
};
