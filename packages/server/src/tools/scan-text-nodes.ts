import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as v from 'valibot';

export const SCAN_TEXT_NODES_TOOL_NAME = 'scan_text_nodes';

export const ScanTextNodesInputSchema = v.object({ root: v.optional(v.string()) });
export type ScanTextNodesInput = v.InferOutput<typeof ScanTextNodesInputSchema>;

export const scanTextNodesToolDefinition: Tool = {
  name: SCAN_TEXT_NODES_TOOL_NAME,
  description:
    'Return every TEXT node within a subtree, each with its characters / fontSize / fontName. ' +
    'Scope with root (a node id); defaults to the current page.',
  inputSchema: {
    type: 'object',
    properties: {
      root: { type: 'string', description: 'Node id to scope the scan; omit for the current page' },
    },
    additionalProperties: false,
  },
};
