import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { PAINT_ITEM_SCHEMA } from './paint-schema.js';

export const UPDATE_PAINT_STYLE_TOOL_NAME = 'update_paint_style';

export const updatePaintStyleToolDefinition: Tool = {
  name: UPDATE_PAINT_STYLE_TOOL_NAME,
  description:
    'Update an existing paint style by id. Any of name / paints / description may be omitted to ' +
    'leave unchanged. Returns { ok, styleId, name }.',
  inputSchema: {
    type: 'object',
    properties: {
      styleId: { type: 'string', description: 'Paint style id to update' },
      name: { type: 'string' },
      paints: { type: 'array', description: 'New paints (SOLID or gradient)', items: PAINT_ITEM_SCHEMA },
      description: { type: 'string' },
    },
    required: ['styleId'],
    additionalProperties: false,
  },
};
