import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const RENAME_PAGE_TOOL_NAME = 'rename_page';

export const renamePageTool: ToolSpec = {
  name: RENAME_PAGE_TOOL_NAME,
  description: 'Rename a page by id. Returns { ok, nodeId }.',
  inputShape: {
    pageId: z.string().describe('Page id to rename'),
    name: z.string().describe('New page name'),
  },
  kind: 'write',
};
