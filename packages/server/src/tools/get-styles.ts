import { specToToolDefinition, type ToolSpec } from './spec.js';

export const GET_STYLES_TOOL_NAME = 'get_styles';

export const getStylesTool: ToolSpec = {
  name: GET_STYLES_TOOL_NAME,
  description:
    "Return the document's local styles grouped as { paints, texts, effects, grids }. " +
    'Paint styles carry their paints; text styles carry fontName / fontSize / lineHeight / letterSpacing; ' +
    'effect styles carry their effects; grid styles carry their layout grids.',
  inputShape: {},
  kind: 'read',
};

export const getStylesToolDefinition = specToToolDefinition(getStylesTool);
