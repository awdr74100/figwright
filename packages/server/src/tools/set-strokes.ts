import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const SET_STROKES_TOOL_NAME = 'set_strokes';

export const setStrokesToolDefinition: Tool = {
  name: SET_STROKES_TOOL_NAME,
  description:
    "Set a node's strokes (SOLID paints, same shape as set_fills) and optional strokeWeight. Returns { ok, nodeId }.",
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Figma node id' },
      strokes: {
        type: 'array',
        description: 'Stroke paints (SOLID only for now)',
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
      strokeWeight: { type: 'number', minimum: 0, description: 'Stroke thickness in px' },
    },
    required: ['nodeId', 'strokes'],
    additionalProperties: false,
  },
};
