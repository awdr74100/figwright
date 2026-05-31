import type { ToolSpec } from './spec.js';

export const GET_SELECTION_TOOL_NAME = 'get_selection';

export const getSelectionTool: ToolSpec = {
  name: GET_SELECTION_TOOL_NAME,
  description:
    'Return the IDs and basic geometry of the currently selected nodes on the active Figma page.',
  inputShape: {},
  kind: 'read',
};
