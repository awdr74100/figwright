import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const SET_FILLS_TOOL_NAME = 'set_fills';

export const setFillsToolDefinition: Tool = {
  name: SET_FILLS_TOOL_NAME,
  description:
    "Set a node's fills. Provide SOLID paints as { type: 'SOLID', color: { r, g, b }, opacity, visible } " +
    'with r/g/b in 0–1. Returns { ok, nodeId }.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Figma node id to repaint' },
      fills: {
        type: 'array',
        description: 'Paints to apply (SOLID only for now)',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['SOLID'] },
            color: {
              type: 'object',
              properties: {
                r: { type: 'number' },
                g: { type: 'number' },
                b: { type: 'number' },
              },
              required: ['r', 'g', 'b'],
            },
            opacity: { type: 'number' },
            visible: { type: 'boolean' },
          },
          required: ['type', 'color'],
        },
      },
    },
    required: ['nodeId', 'fills'],
    additionalProperties: false,
  },
};
