import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { PAINT_ITEM_SCHEMA } from './paint-schema.js';

export const SET_STROKES_TOOL_NAME = 'set_strokes';

export const setStrokesToolDefinition: Tool = {
  name: SET_STROKES_TOOL_NAME,
  description:
    "Set a node's strokes (SOLID or gradient paints, same shape as set_fills) and optional strokeWeight. Returns { ok, nodeId }.",
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Figma node id' },
      strokes: { type: 'array', description: 'Stroke paints', items: PAINT_ITEM_SCHEMA },
      strokeWeight: { type: 'number', minimum: 0, description: 'Stroke thickness in px' },
    },
    required: ['nodeId', 'strokes'],
    additionalProperties: false,
  },
};
