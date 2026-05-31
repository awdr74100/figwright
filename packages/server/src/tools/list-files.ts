import type { ToolSpec } from './spec.js';

export const LIST_FILES_TOOL_NAME = 'list_files';

export const listFilesTool: ToolSpec = {
  name: LIST_FILES_TOOL_NAME,
  description:
    'Return the files reachable from the plugin as { files: [{ fileKey, fileName, currentPage }] }. ' +
    'A plugin only sees its host document, so this is a single-element list describing the current file.',
  inputShape: {},
  kind: 'read',
};
