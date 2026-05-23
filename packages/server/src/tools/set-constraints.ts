import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const SET_CONSTRAINTS_TOOL_NAME = 'set_constraints';

const CONSTRAINT_ENUM = ['MIN', 'CENTER', 'MAX', 'STRETCH', 'SCALE'];

export const setConstraintsToolDefinition: Tool = {
  name: SET_CONSTRAINTS_TOOL_NAME,
  description: "Set a node's resize constraints relative to its parent. Returns { ok, nodeId }.",
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string' },
      horizontal: { type: 'string', enum: CONSTRAINT_ENUM },
      vertical: { type: 'string', enum: CONSTRAINT_ENUM },
    },
    required: ['nodeId', 'horizontal', 'vertical'],
    additionalProperties: false,
  },
};
