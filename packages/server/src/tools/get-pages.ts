import { specToToolDefinition, type ToolSpec } from './spec.js';

export const GET_PAGES_TOOL_NAME = 'get_pages';

export const getPagesTool: ToolSpec = {
  name: GET_PAGES_TOOL_NAME,
  description: 'Return id+name of every page in the active Figma file.',
  inputShape: {},
  kind: 'read',
};

export const getPagesToolDefinition = specToToolDefinition(getPagesTool);
