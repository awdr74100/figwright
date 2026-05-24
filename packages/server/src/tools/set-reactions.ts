import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const SET_REACTIONS_TOOL_NAME = 'set_reactions';

export const setReactionsToolDefinition: Tool = {
  name: SET_REACTIONS_TOOL_NAME,
  description:
    "Replace a node's prototype reactions. Each reaction has a trigger (e.g. { type: 'ON_CLICK' }) " +
    "and an actions array (e.g. { type: 'NODE', destinationId, navigation, transition }). Best used " +
    'to round-trip get_reactions output. Returns { ok, nodeId }.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Node to set reactions on' },
      reactions: {
        type: 'array',
        description: 'Reactions to apply (replaces existing)',
        items: {
          type: 'object',
          properties: {
            trigger: {
              type: ['object', 'null'],
              properties: {
                type: { type: 'string' },
                timeout: { type: 'number' },
                delay: { type: 'number' },
              },
            },
            actions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  destinationId: { type: ['string', 'null'] },
                  navigation: { type: 'string' },
                  url: { type: 'string' },
                },
                required: ['type'],
              },
            },
          },
          required: ['trigger', 'actions'],
        },
      },
    },
    required: ['nodeId', 'reactions'],
    additionalProperties: false,
  },
};
