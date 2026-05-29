import { z } from 'zod';

import { specToToolDefinition, type ToolSpec } from './spec.js';

export const DELETE_PAGE_TOOL_NAME = 'delete_page';

export const deletePageTool: ToolSpec = {
  name: DELETE_PAGE_TOOL_NAME,
  description:
    'Delete a page by id. The current page and the last remaining page cannot be deleted. ' +
    'Returns { ok, nodeId }.',
  inputShape: {
    pageId: z.string().describe('Page id to delete'),
  },
  kind: 'write',
};

export const deletePageToolDefinition = specToToolDefinition(deletePageTool);
