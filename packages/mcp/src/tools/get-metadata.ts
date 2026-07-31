import type { ToolSpec } from './spec.js';

export const GET_METADATA_TOOL_NAME = 'get_metadata';

export const getMetadataTool: ToolSpec = {
  name: GET_METADATA_TOOL_NAME,
  description:
    'Return file metadata: fileName, current page, all page references, and which editor the file ' +
    'is open in (editorType / mode) — "dev" is read-only and "figjam" has no components, ' +
    'variables or styles.',
  inputShape: {},
  kind: 'read',
};
