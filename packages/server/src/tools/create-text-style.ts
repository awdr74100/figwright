import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const CREATE_TEXT_STYLE_TOOL_NAME = 'create_text_style';

export const createTextStyleToolDefinition: Tool = {
  name: CREATE_TEXT_STYLE_TOOL_NAME,
  description:
    'Create a local text style. The font is loaded before assignment. lineHeight unit is ' +
    'AUTO / PIXELS / PERCENT (AUTO omits value); letterSpacing unit is PIXELS / PERCENT. ' +
    'Returns { ok, styleId, name }.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Style name, e.g. "Heading/H1"' },
      fontName: {
        type: 'object',
        properties: { family: { type: 'string' }, style: { type: 'string' } },
        required: ['family', 'style'],
      },
      fontSize: { type: 'number' },
      lineHeight: {
        type: 'object',
        properties: {
          unit: { type: 'string', enum: ['AUTO', 'PIXELS', 'PERCENT'] },
          value: { type: 'number' },
        },
        required: ['unit'],
      },
      letterSpacing: {
        type: 'object',
        properties: {
          unit: { type: 'string', enum: ['PIXELS', 'PERCENT'] },
          value: { type: 'number' },
        },
        required: ['unit', 'value'],
      },
      description: { type: 'string' },
    },
    required: ['name'],
    additionalProperties: false,
  },
};
