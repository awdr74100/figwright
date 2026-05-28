import { specToToolDefinition, type ToolSpec } from './spec.js';

export const GET_METADATA_TOOL_NAME = 'get_metadata';

export const getMetadataTool: ToolSpec = {
  name: GET_METADATA_TOOL_NAME,
  description: 'Return file metadata: fileName, current page, and all page references.',
  inputShape: {},
  kind: 'read',
};

export const getMetadataToolDefinition = specToToolDefinition(getMetadataTool);
