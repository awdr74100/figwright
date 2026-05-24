import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const DELETE_STYLE_TOOL_NAME = 'delete_style';

export const deleteStyleToolDefinition: Tool = {
  name: DELETE_STYLE_TOOL_NAME,
  description: 'Delete a local style (paint / text / effect / grid) by id. Returns { ok, styleId, name }.',
  inputSchema: {
    type: 'object',
    properties: {
      styleId: { type: 'string', description: 'Style id to delete' },
    },
    required: ['styleId'],
    additionalProperties: false,
  },
};
