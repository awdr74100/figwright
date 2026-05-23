import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as v from 'valibot';

export const GET_ANNOTATIONS_TOOL_NAME = 'get_annotations';

export const GetAnnotationsInputSchema = v.object({ nodeId: v.optional(v.string()) });
export type GetAnnotationsInput = v.InferOutput<typeof GetAnnotationsInputSchema>;

export const getAnnotationsToolDefinition: Tool = {
  name: GET_ANNOTATIONS_TOOL_NAME,
  description:
    'Return Dev Mode annotations as { annotations: [{ nodeId, nodeName, annotations }] }. ' +
    'With nodeId, returns that node\'s annotations; without it, scans the current page for all ' +
    'annotated nodes.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Node id to read annotations from; omit to scan the current page' },
    },
    additionalProperties: false,
  },
};
