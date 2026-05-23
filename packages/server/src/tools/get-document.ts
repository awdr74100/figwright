import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as v from 'valibot';

export const GET_DOCUMENT_TOOL_NAME = 'get_document';

export const GetDocumentInputSchema = v.object({});
export type GetDocumentInput = v.InferOutput<typeof GetDocumentInputSchema>;

export const getDocumentToolDefinition: Tool = {
  name: GET_DOCUMENT_TOOL_NAME,
  description:
    'Return the full node tree (recursive children) of the active Figma page, with base geometry, rotation, opacity, cornerRadius, and fills enrichment.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
};
