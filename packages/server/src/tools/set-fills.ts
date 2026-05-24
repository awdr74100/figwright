import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { PAINT_ITEM_SCHEMA } from './paint-schema.js';

export const SET_FILLS_TOOL_NAME = 'set_fills';

export const setFillsToolDefinition: Tool = {
  name: SET_FILLS_TOOL_NAME,
  description:
    "Set a node's fills. SOLID: { type:'SOLID', color:{r,g,b} } (0–1). Gradient: " +
    "{ type:'GRADIENT_LINEAR'|…, gradientStops:[{position,color:{r,g,b,a}}], gradientTransform } " +
    '(round-trips get_node output). Returns { ok, nodeId }.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Figma node id to repaint' },
      fills: { type: 'array', description: 'Paints to apply', items: PAINT_ITEM_SCHEMA },
    },
    required: ['nodeId', 'fills'],
    additionalProperties: false,
  },
};
