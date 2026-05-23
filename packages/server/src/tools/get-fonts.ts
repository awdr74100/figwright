import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const GET_FONTS_TOOL_NAME = 'get_fonts';

export const getFontsToolDefinition: Tool = {
  name: GET_FONTS_TOOL_NAME,
  description:
    'Return every font used on the current page as { fonts: [{ fontName, count }] }, sorted by ' +
    'usage frequency (descending). Mixed-font text contributes one count per styled segment.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};
