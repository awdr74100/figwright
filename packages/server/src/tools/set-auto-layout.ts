import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const SET_AUTO_LAYOUT_TOOL_NAME = 'set_auto_layout';

export const setAutoLayoutToolDefinition: Tool = {
  name: SET_AUTO_LAYOUT_TOOL_NAME,
  description:
    'Configure a frame\'s auto layout. layoutMode NONE disables it; HORIZONTAL/VERTICAL enable it ' +
    'with optional padding / itemSpacing / alignment / wrap. Returns { ok, nodeId }.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string' },
      layoutMode: { type: 'string', enum: ['NONE', 'HORIZONTAL', 'VERTICAL'] },
      paddingTop: { type: 'number' },
      paddingRight: { type: 'number' },
      paddingBottom: { type: 'number' },
      paddingLeft: { type: 'number' },
      itemSpacing: { type: 'number' },
      primaryAxisAlignItems: { type: 'string', enum: ['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN'] },
      counterAxisAlignItems: { type: 'string', enum: ['MIN', 'CENTER', 'MAX', 'BASELINE'] },
      layoutWrap: { type: 'string', enum: ['NO_WRAP', 'WRAP'] },
    },
    required: ['nodeId', 'layoutMode'],
    additionalProperties: false,
  },
};
