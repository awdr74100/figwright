import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const SWAP_COMPONENT_TOOL_NAME = 'swap_component';

export const swapComponentToolDefinition: Tool = {
  name: SWAP_COMPONENT_TOOL_NAME,
  description:
    "Swap an instance's main component. Provide componentKey (published component, imported via the " +
    'API) or componentId (a local COMPONENT node). Returns { ok, nodeId } (the instance id).',
  inputSchema: {
    type: 'object',
    properties: {
      instanceId: { type: 'string', description: 'Instance node id to swap' },
      componentId: { type: 'string', description: 'Local component node id' },
      componentKey: { type: 'string', description: 'Published component key' },
    },
    required: ['instanceId'],
    additionalProperties: false,
  },
};
