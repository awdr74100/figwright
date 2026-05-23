import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as v from 'valibot';

export const GET_PAGES_TOOL_NAME = 'get_pages';

export const GetPagesInputSchema = v.object({});
export type GetPagesInput = v.InferOutput<typeof GetPagesInputSchema>;

export const getPagesToolDefinition: Tool = {
  name: GET_PAGES_TOOL_NAME,
  description: 'Return id+name of every page in the active Figma file.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
};
