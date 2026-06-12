import type { ToolSpec } from './spec.js';

export const GET_FONTS_TOOL_NAME = 'get_fonts';

export const getFontsTool: ToolSpec = {
  name: GET_FONTS_TOOL_NAME,
  description:
    'Return every font used on the current page as { fonts: [{ fontName, count }] }, sorted by ' +
    'usage frequency (descending). Mixed-font text contributes one count per styled segment.',
  inputShape: {},
  kind: 'read',
};
