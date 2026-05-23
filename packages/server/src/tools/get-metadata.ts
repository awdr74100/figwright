import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as v from 'valibot';

export const GET_METADATA_TOOL_NAME = 'get_metadata';

export const GetMetadataInputSchema = v.object({});
export type GetMetadataInput = v.InferOutput<typeof GetMetadataInputSchema>;

export const getMetadataToolDefinition: Tool = {
  name: GET_METADATA_TOOL_NAME,
  description: 'Return file metadata: fileName, current page, and all page references.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
};
