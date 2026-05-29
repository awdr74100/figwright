import type { ToolSpec } from './spec.js';

export const GET_VIEWPORT_TOOL_NAME = 'get_viewport';

export const getViewportTool: ToolSpec = {
  name: GET_VIEWPORT_TOOL_NAME,
  description:
    'Return the current page viewport as { center, zoom, bounds } — the on-screen center point, ' +
    'zoom level (1.0 = 100%), and visible bounds rect.',
  inputShape: {},
  kind: 'read',
};
