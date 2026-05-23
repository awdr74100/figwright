import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as v from 'valibot';

export const GET_SELECTION_TOOL_NAME = 'get_selection';

export const GetSelectionInputSchema = v.object({});
export type GetSelectionInput = v.InferOutput<typeof GetSelectionInputSchema>;

export const getSelectionToolDefinition: Tool = {
  name: GET_SELECTION_TOOL_NAME,
  description:
    'Return the IDs and basic geometry of the currently selected nodes on the active Figma page.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
};
