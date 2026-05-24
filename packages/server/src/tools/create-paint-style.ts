import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const CREATE_PAINT_STYLE_TOOL_NAME = 'create_paint_style';

export const createPaintStyleToolDefinition: Tool = {
  name: CREATE_PAINT_STYLE_TOOL_NAME,
  description:
    'Create a local paint (color) style. Provide SOLID paints as ' +
    "{ type: 'SOLID', color: { r, g, b }, opacity, visible } with r/g/b in 0–1. " +
    'Use a/b/c slashes in the name for folder grouping. Returns { ok, styleId, name }.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Style name, e.g. "Brand/Primary"' },
      paints: {
        type: 'array',
        description: 'Paints (SOLID only for now)',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['SOLID'] },
            color: {
              type: 'object',
              properties: { r: { type: 'number' }, g: { type: 'number' }, b: { type: 'number' } },
              required: ['r', 'g', 'b'],
            },
            opacity: { type: 'number' },
            visible: { type: 'boolean' },
          },
          required: ['type', 'color'],
        },
      },
      description: { type: 'string', description: 'Optional style description' },
    },
    required: ['name', 'paints'],
    additionalProperties: false,
  },
};
