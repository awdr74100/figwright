import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as v from 'valibot';

export const GET_NODE_TOOL_NAME = 'get_node';

export const GetNodeInputSchema = v.object({ nodeId: v.string() });
export type GetNodeInput = v.InferOutput<typeof GetNodeInputSchema>;

export const getNodeToolDefinition: Tool = {
  name: GET_NODE_TOOL_NAME,
  description: 'Return a single Figma node by id, with full recursive children subtree.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Figma node id, e.g. "1:42"' },
    },
    required: ['nodeId'],
    additionalProperties: false,
  },
};
