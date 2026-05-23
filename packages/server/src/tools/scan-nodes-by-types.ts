import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as v from 'valibot';

export const SCAN_NODES_BY_TYPES_TOOL_NAME = 'scan_nodes_by_types';

export const ScanNodesByTypesInputSchema = v.object({
  types: v.array(v.string()),
  root: v.optional(v.string()),
});
export type ScanNodesByTypesInput = v.InferOutput<typeof ScanNodesByTypesInputSchema>;

export const scanNodesByTypesToolDefinition: Tool = {
  name: SCAN_NODES_BY_TYPES_TOOL_NAME,
  description:
    'Return every node whose type is in the given types list, within a subtree. ' +
    'Scope with root (a node id); defaults to the current page. Returns a flat array of matching nodes.',
  inputSchema: {
    type: 'object',
    properties: {
      types: {
        type: 'array',
        items: { type: 'string' },
        description: 'Node types to match, e.g. ["FRAME", "COMPONENT"]',
      },
      root: { type: 'string', description: 'Node id to scope the scan; omit for the current page' },
    },
    required: ['types'],
    additionalProperties: false,
  },
};
