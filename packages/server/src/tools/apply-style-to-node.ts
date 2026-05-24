import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const APPLY_STYLE_TO_NODE_TOOL_NAME = 'apply_style_to_node';

export const applyStyleToNodeToolDefinition: Tool = {
  name: APPLY_STYLE_TO_NODE_TOOL_NAME,
  description:
    'Bind a shared style to a node. `field` selects which slot the style applies to: fill / ' +
    'stroke / effect / grid / text. Returns { ok, nodeId }.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Node to apply the style to' },
      styleId: { type: 'string', description: 'Style id to bind' },
      field: { type: 'string', enum: ['fill', 'stroke', 'effect', 'grid', 'text'] },
    },
    required: ['nodeId', 'styleId', 'field'],
    additionalProperties: false,
  },
};
