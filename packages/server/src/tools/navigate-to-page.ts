import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const NAVIGATE_TO_PAGE_TOOL_NAME = 'navigate_to_page';

export const navigateToPageToolDefinition: Tool = {
  name: NAVIGATE_TO_PAGE_TOOL_NAME,
  description:
    'Switch the active page. Subsequent selection / read tools operate on this page. ' +
    'Returns { ok, nodeId }.',
  inputSchema: {
    type: 'object',
    properties: {
      pageId: { type: 'string', description: 'Page id to navigate to' },
    },
    required: ['pageId'],
    additionalProperties: false,
  },
};
