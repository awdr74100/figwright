import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as v from 'valibot';

export const GET_NODES_INFO_TOOL_NAME = 'get_nodes_info';

export const GetNodesInfoInputSchema = v.object({ nodeIds: v.array(v.string()) });
export type GetNodesInfoInput = v.InferOutput<typeof GetNodesInfoInputSchema>;

export const getNodesInfoToolDefinition: Tool = {
  name: GET_NODES_INFO_TOOL_NAME,
  description:
    'Return multiple Figma nodes by id. Output preserves input order; missing ids slot null.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Figma node ids to fetch',
      },
    },
    required: ['nodeIds'],
    additionalProperties: false,
  },
};
