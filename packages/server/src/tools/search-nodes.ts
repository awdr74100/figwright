import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SEARCH_NODES_TOOL_NAME = 'search_nodes';

export const searchNodesTool: ToolSpec = {
  name: SEARCH_NODES_TOOL_NAME,
  description:
    'Search the node tree by case-insensitive name substring and/or exact node type. ' +
    'At least one of name or type is required. Scope to a subtree with root (a node id); ' +
    'defaults to the current page. Returns a flat array of matching nodes.',
  inputShape: {
    name: z.string().describe('Case-insensitive substring matched against node names').optional(),
    type: z.string().describe('Exact node type to match, e.g. "TEXT", "FRAME"').optional(),
    root: z.string().describe('Node id to scope the search; omit for the current page').optional(),
  },
  kind: 'read',
};
