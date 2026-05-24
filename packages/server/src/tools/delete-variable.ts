import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const DELETE_VARIABLE_TOOL_NAME = 'delete_variable';

export const deleteVariableToolDefinition: Tool = {
  name: DELETE_VARIABLE_TOOL_NAME,
  description: 'Delete a variable by id. Returns { ok, variableId, name }.',
  inputSchema: {
    type: 'object',
    properties: {
      variableId: { type: 'string', description: 'Variable id to delete' },
    },
    required: ['variableId'],
    additionalProperties: false,
  },
};
