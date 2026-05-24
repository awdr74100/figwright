import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const SET_VARIABLE_VALUE_TOOL_NAME = 'set_variable_value';

export const setVariableValueToolDefinition: Tool = {
  name: SET_VARIABLE_VALUE_TOOL_NAME,
  description:
    "Set a variable's value for a mode. value is a boolean / number / string, a color " +
    '{ r, g, b, a } (0–1), or an alias { type: "VARIABLE_ALIAS", id }. Returns { ok, variableId, name }.',
  inputSchema: {
    type: 'object',
    properties: {
      variableId: { type: 'string', description: 'Variable id' },
      modeId: { type: 'string', description: 'Mode id (from the collection)' },
      value: {
        // Declaring the union is load-bearing: an untyped property gets coerced to a string by some
        // MCP clients in transit, which then fails Figma's setValueForMode type check for every
        // non-STRING variable. The plugin also coerces by resolvedType as a belt-and-suspenders guard.
        type: ['boolean', 'number', 'string', 'object'],
        description: 'boolean | number | string | { r,g,b,a } | { type:"VARIABLE_ALIAS", id }',
      },
    },
    required: ['variableId', 'modeId', 'value'],
    additionalProperties: false,
  },
};
