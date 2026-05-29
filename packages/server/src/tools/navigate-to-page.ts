import { z } from 'zod';

import { specToToolDefinition, type ToolSpec } from './spec.js';

export const NAVIGATE_TO_PAGE_TOOL_NAME = 'navigate_to_page';

export const navigateToPageTool: ToolSpec = {
  name: NAVIGATE_TO_PAGE_TOOL_NAME,
  description:
    'Switch the active page. Subsequent selection / read tools operate on this page. ' +
    'Returns { ok, nodeId }.',
  inputShape: {
    pageId: z.string().describe('Page id to navigate to'),
  },
  kind: 'write',
};

export const navigateToPageToolDefinition = specToToolDefinition(navigateToPageTool);
