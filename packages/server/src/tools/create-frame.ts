import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const CREATE_FRAME_TOOL_NAME = 'create_frame';

export const createFrameToolDefinition: Tool = {
  name: CREATE_FRAME_TOOL_NAME,
  description:
    'Create a frame, optionally sized/positioned and appended to a parent (else the current page). ' +
    'Returns { ok, nodeId, name, type }.',
  inputSchema: {
    type: 'object',
    properties: {
      parentId: { type: 'string', description: 'Container node id to append into; omit for current page' },
      name: { type: 'string', description: 'Frame name' },
      x: { type: 'number' },
      y: { type: 'number' },
      width: { type: 'number', description: 'Frame width (with height, resizes from default)' },
      height: { type: 'number', description: 'Frame height (with width, resizes from default)' },
    },
    required: [],
    additionalProperties: false,
  },
};
