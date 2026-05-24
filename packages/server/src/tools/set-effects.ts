import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const SET_EFFECTS_TOOL_NAME = 'set_effects';

const effectItem = {
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
      description: 'Shadow color (RGBA 0–1). Required for shadows.',
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
      description: 'Shadow offset in px. Required for shadows.',
      properties: { x: { type: 'number' }, y: { type: 'number' } },
      required: ['x', 'y'],
    },
    spread: { type: 'number' },
  },
  required: ['type', 'visible'],
};

export const setEffectsToolDefinition: Tool = {
  name: SET_EFFECTS_TOOL_NAME,
  description:
    "Set a node's effects. Shadows (DROP_SHADOW / INNER_SHADOW) need color + offset; blurs need " +
    'radius. Returns { ok, nodeId }.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Figma node id to apply effects to' },
      effects: { type: 'array', description: 'Effects to apply', items: effectItem },
    },
    required: ['nodeId', 'effects'],
    additionalProperties: false,
  },
};
