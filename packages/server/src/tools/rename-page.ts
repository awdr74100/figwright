import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const RENAME_PAGE_TOOL_NAME = 'rename_page';

export const renamePageToolDefinition: Tool = {
  name: RENAME_PAGE_TOOL_NAME,
  description: 'Rename a page by id. Returns { ok, nodeId }.',
  inputSchema: {
    type: 'object',
    properties: {
      pageId: { type: 'string', description: 'Page id to rename' },
      name: { type: 'string', description: 'New page name' },
    },
    required: ['pageId', 'name'],
    additionalProperties: false,
  },
};
