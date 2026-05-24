import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { PAINT_ITEM_SCHEMA } from './paint-schema.js';

export const CREATE_PAINT_STYLE_TOOL_NAME = 'create_paint_style';

export const createPaintStyleToolDefinition: Tool = {
  name: CREATE_PAINT_STYLE_TOOL_NAME,
  description:
    'Create a local paint (color) style. SOLID or gradient paints (same shape as set_fills). ' +
    'Use a/b/c slashes in the name for folder grouping. Returns { ok, styleId, name }.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Style name, e.g. "Brand/Primary"' },
      paints: { type: 'array', description: 'Paints', items: PAINT_ITEM_SCHEMA },
      description: { type: 'string', description: 'Optional style description' },
    },
    required: ['name', 'paints'],
    additionalProperties: false,
  },
};
