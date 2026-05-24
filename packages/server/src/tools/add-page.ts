import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const ADD_PAGE_TOOL_NAME = 'add_page';

export const addPageToolDefinition: Tool = {
  name: ADD_PAGE_TOOL_NAME,
  description: 'Create a new page (optionally named). Returns { ok, nodeId, name, type }.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Optional page name' },
    },
    additionalProperties: false,
  },
};
