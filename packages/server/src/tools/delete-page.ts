import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const DELETE_PAGE_TOOL_NAME = 'delete_page';

export const deletePageToolDefinition: Tool = {
  name: DELETE_PAGE_TOOL_NAME,
  description:
    'Delete a page by id. The current page and the last remaining page cannot be deleted. ' +
    'Returns { ok, nodeId }.',
  inputSchema: {
    type: 'object',
    properties: {
      pageId: { type: 'string', description: 'Page id to delete' },
    },
    required: ['pageId'],
    additionalProperties: false,
  },
};
