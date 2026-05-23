import { DETAIL_LEVELS } from '@figma-mcp-relay/shared';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as v from 'valibot';

export const GET_DESIGN_CONTEXT_TOOL_NAME = 'get_design_context';

export const GetDesignContextInputSchema = v.object({
  nodeId: v.optional(v.string()),
  depth: v.optional(v.pipe(v.number(), v.minValue(0))),
  detail: v.optional(v.picklist(DETAIL_LEVELS)),
  dedupeComponents: v.optional(v.boolean()),
});
export type GetDesignContextInput = v.InferOutput<typeof GetDesignContextInputSchema>;

export const getDesignContextToolDefinition: Tool = {
  name: GET_DESIGN_CONTEXT_TOOL_NAME,
  description:
    'Get a depth-limited, token-efficient node tree for exploring large files — prefer this over ' +
    'get_document. Starts from nodeId, else the current selection, else the current page. ' +
    'depth limits child levels (omit or 0 = unlimited). detail is minimal / compact / full. ' +
    'dedupeComponents collapses repeated component instances (children of an already-seen main ' +
    'component are omitted and flagged deduped).',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Root node id; omit to use the selection or current page' },
      depth: { type: 'number', minimum: 0, description: 'Max child levels to include; omit or 0 for unlimited' },
      detail: {
        type: 'string',
        enum: [...DETAIL_LEVELS],
        description: 'How much per-node data: minimal / compact (default) / full',
      },
      dedupeComponents: {
        type: 'boolean',
        description: 'Collapse repeated instances of the same main component',
      },
    },
    additionalProperties: false,
  },
};
