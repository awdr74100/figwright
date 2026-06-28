import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const RENAME_PAGE_TOOL_NAME = 'rename_page';

export const renamePageTool: ToolSpec = {
  name: RENAME_PAGE_TOOL_NAME,
  description:
    'Rename a Figma page (a top-level page/tab in the document) by id. Affects only the page name; ' +
    'its node id and contents are unchanged. To rename a layer/node on the canvas use rename_node ' +
    'instead. Returns { ok, nodeId }.',
  inputShape: {
    pageId: z.string().describe('Page id to rename'),
    name: z.string().describe('New page name'),
  },
  kind: 'write',
};
