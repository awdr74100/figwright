import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const DETACH_INSTANCE_TOOL_NAME = 'detach_instance';

export const detachInstanceToolDefinition: Tool = {
  name: DETACH_INSTANCE_TOOL_NAME,
  description:
    'Detach an instance into a plain frame (breaks the component link). ' +
    'Returns { ok, nodeId, name, type } for the resulting frame.',
  inputSchema: {
    type: 'object',
    properties: {
      instanceId: { type: 'string', description: 'Instance node id to detach' },
    },
    required: ['instanceId'],
    additionalProperties: false,
  },
};
