import type { ToolSpec } from './spec.js';

export const GET_DOCUMENT_TOOL_NAME = 'get_document';

export const getDocumentTool: ToolSpec = {
  name: GET_DOCUMENT_TOOL_NAME,
  description:
    'Return the full node tree (recursive children) of the active Figma page, with base geometry, rotation, opacity, cornerRadius, and fills enrichment.',
  inputShape: {},
  kind: 'read',
};
