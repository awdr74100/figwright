import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const FIND_REPLACE_TEXT_TOOL_NAME = 'find_replace_text';

export const findReplaceTextTool: ToolSpec = {
  name: FIND_REPLACE_TEXT_TOOL_NAME,
  description:
    'Replace a substring across all TEXT nodes under a scope. Without rootId the whole current ' +
    'page is searched; matching is case-insensitive unless caseSensitive is true. Fonts are loaded ' +
    'before each edit. Returns { ok, affected } — the text node ids changed.',
  inputShape: {
    find: z.string().describe('Substring to find (non-empty)'),
    replace: z.string().describe('Replacement string'),
    rootId: z.string().optional().describe('Optional node id to scope the search (default: page)'),
    caseSensitive: z.boolean().optional().describe('Match case (default false)'),
  },
  kind: 'write',
};
