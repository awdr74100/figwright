import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as v from 'valibot';

export const SEARCH_NODES_TOOL_NAME = 'search_nodes';

export const SearchNodesInputSchema = v.object({
  name: v.optional(v.string()),
  type: v.optional(v.string()),
  root: v.optional(v.string()),
});
export type SearchNodesInput = v.InferOutput<typeof SearchNodesInputSchema>;

export const searchNodesToolDefinition: Tool = {
  name: SEARCH_NODES_TOOL_NAME,
  description:
    'Search the node tree by case-insensitive name substring and/or exact node type. ' +
    'At least one of name or type is required. Scope to a subtree with root (a node id); ' +
    'defaults to the current page. Returns a flat array of matching nodes.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Case-insensitive substring matched against node names' },
      type: { type: 'string', description: 'Exact node type to match, e.g. "TEXT", "FRAME"' },
      root: { type: 'string', description: 'Node id to scope the search; omit for the current page' },
    },
    additionalProperties: false,
  },
};
