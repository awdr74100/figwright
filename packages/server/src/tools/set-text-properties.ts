import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const SET_TEXT_PROPERTIES_TOOL_NAME = 'set_text_properties';

export const setTextPropertiesToolDefinition: Tool = {
  name: SET_TEXT_PROPERTIES_TOOL_NAME,
  description:
    "Set a TEXT node's layout/overflow properties: textTruncation (ellipsis), maxLines (line clamp), " +
    'textAutoResize. Any field may be omitted to leave it unchanged. maxLines applies when ' +
    'textTruncation is ENDING. Returns { ok, nodeId }.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'TEXT node id' },
      textTruncation: {
        type: 'string',
        enum: ['DISABLED', 'ENDING'],
        description: 'ENDING truncates with an ellipsis',
      },
      maxLines: {
        type: ['number', 'null'],
        description: 'Max lines before truncation; null = unlimited',
      },
      textAutoResize: {
        type: 'string',
        enum: ['NONE', 'HEIGHT', 'WIDTH_AND_HEIGHT', 'TRUNCATE'],
        description: 'How the text box resizes to its content',
      },
    },
    required: ['nodeId'],
    additionalProperties: false,
  },
};
