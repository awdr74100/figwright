import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const LIST_FILES_TOOL_NAME = 'list_files';

export const listFilesToolDefinition: Tool = {
  name: LIST_FILES_TOOL_NAME,
  description:
    'Return the files reachable from the plugin as { files: [{ fileKey, fileName, currentPage }] }. ' +
    'A plugin only sees its host document, so this is a single-element list describing the current file.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};
