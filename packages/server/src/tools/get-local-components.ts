import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const GET_LOCAL_COMPONENTS_TOOL_NAME = 'get_local_components';

export const getLocalComponentsToolDefinition: Tool = {
  name: GET_LOCAL_COMPONENTS_TOOL_NAME,
  description:
    'Return all local components and component sets across the document as { components, componentSets }. ' +
    'Components carry their variantProperties (when part of a set); component sets carry their ' +
    'variantGroupProperties (available values per axis) and the ids of their variant components.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};
