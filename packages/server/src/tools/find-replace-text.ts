import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const FIND_REPLACE_TEXT_TOOL_NAME = 'find_replace_text';

export const findReplaceTextToolDefinition: Tool = {
  name: FIND_REPLACE_TEXT_TOOL_NAME,
  description:
    'Replace a substring across all TEXT nodes under a scope. Without rootId the whole current ' +
    'page is searched; matching is case-insensitive unless caseSensitive is true. Fonts are loaded ' +
    'before each edit. Returns { ok, affected } — the text node ids changed.',
  inputSchema: {
    type: 'object',
    properties: {
      find: { type: 'string', description: 'Substring to find (non-empty)' },
      replace: { type: 'string', description: 'Replacement string' },
      rootId: { type: 'string', description: 'Optional node id to scope the search (default: page)' },
      caseSensitive: { type: 'boolean', description: 'Match case (default false)' },
    },
    required: ['find', 'replace'],
    additionalProperties: false,
  },
};
