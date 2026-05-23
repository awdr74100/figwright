import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const GET_VARIABLE_DEFS_TOOL_NAME = 'get_variable_defs';

export const getVariableDefsToolDefinition: Tool = {
  name: GET_VARIABLE_DEFS_TOOL_NAME,
  description:
    'Return the document\'s local variables as { collections, variables }. Each collection lists its modes ' +
    'and defaultModeId; each variable lists its resolvedType and valuesByMode (primitives, RGBA colors, ' +
    'or { type: "VARIABLE_ALIAS", id } references to other variables).',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};
