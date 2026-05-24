import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const CREATE_EFFECT_STYLE_TOOL_NAME = 'create_effect_style';

export const createEffectStyleToolDefinition: Tool = {
  name: CREATE_EFFECT_STYLE_TOOL_NAME,
  description:
    'Create a local effect style. Shadows (DROP_SHADOW / INNER_SHADOW) need color + offset; ' +
    'blurs (LAYER_BLUR / BACKGROUND_BLUR) need radius. Returns { ok, styleId, name }.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Style name, e.g. "Elevation/Card"' },
      effects: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['DROP_SHADOW', 'INNER_SHADOW', 'LAYER_BLUR', 'BACKGROUND_BLUR'],
            },
            visible: { type: 'boolean' },
            radius: { type: 'number' },
            color: {
              type: 'object',
              properties: {
                r: { type: 'number' },
                g: { type: 'number' },
                b: { type: 'number' },
                a: { type: 'number' },
              },
              required: ['r', 'g', 'b', 'a'],
            },
            offset: {
              type: 'object',
              properties: { x: { type: 'number' }, y: { type: 'number' } },
              required: ['x', 'y'],
            },
            spread: { type: 'number' },
          },
          required: ['type', 'visible'],
        },
      },
      description: { type: 'string' },
    },
    required: ['name', 'effects'],
    additionalProperties: false,
  },
};
