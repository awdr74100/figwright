import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as v from 'valibot';

export const GET_REACTIONS_TOOL_NAME = 'get_reactions';

export const GetReactionsInputSchema = v.object({ nodeId: v.string() });
export type GetReactionsInput = v.InferOutput<typeof GetReactionsInputSchema>;

export const getReactionsToolDefinition: Tool = {
  name: GET_REACTIONS_TOOL_NAME,
  description:
    'Return the prototype reactions on a node as { nodeId, reactions: [{ trigger, actions }] }. ' +
    'Each reaction pairs an interaction trigger (click, hover, timeout…) with its actions ' +
    '(navigate to node, open URL, back/close…).',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Figma node id to read reactions from' },
    },
    required: ['nodeId'],
    additionalProperties: false,
  },
};
