import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const BIND_VARIABLE_TO_NODE_TOOL_NAME = 'bind_variable_to_node';

export const bindVariableToNodeToolDefinition: Tool = {
  name: BIND_VARIABLE_TO_NODE_TOOL_NAME,
  description:
    'Bind a variable to a node field (e.g. width, height, characters, itemSpacing, ' +
    'topLeftRadius). The variable type must match the field. Returns { ok, nodeId }.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Node to bind on' },
      field: { type: 'string', description: 'Bindable field name, e.g. "width"' },
      variableId: { type: 'string', description: 'Variable id to bind' },
    },
    required: ['nodeId', 'field', 'variableId'],
    additionalProperties: false,
  },
};
