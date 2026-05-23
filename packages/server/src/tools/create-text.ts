import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const CREATE_TEXT_TOOL_NAME = 'create_text';

export const createTextToolDefinition: Tool = {
  name: CREATE_TEXT_TOOL_NAME,
  description:
    'Create a TEXT node with the given characters (default font loaded automatically), optionally ' +
    'sized/positioned and appended to a parent (else the current page). Returns { ok, nodeId, name, type }.',
  inputSchema: {
    type: 'object',
    properties: {
      characters: { type: 'string', description: 'Text content' },
      parentId: { type: 'string', description: 'Container node id; omit for current page' },
      x: { type: 'number' },
      y: { type: 'number' },
      fontSize: { type: 'number' },
    },
    required: ['characters'],
    additionalProperties: false,
  },
};
