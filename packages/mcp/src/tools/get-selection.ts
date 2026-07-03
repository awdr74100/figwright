import type { ToolSpec } from './spec.js';

export const GET_SELECTION_TOOL_NAME = 'get_selection';

export const getSelectionTool: ToolSpec = {
  name: GET_SELECTION_TOOL_NAME,
  description:
    'Return the current selection on the active Figma page: { pageId, pageName, nodes }, where ' +
    'each node is a full flat serialization — geometry, fills/strokes/effects, text properties, ' +
    'style/variable ids, mainComponent — without children. The zero-argument "what is the user ' +
    'looking at" call: use it to identify the selected node ids (and page), then walk deeper with ' +
    'get_design_context or get_node. An empty nodes array means nothing is selected.',
  inputShape: {},
  kind: 'read',
};
