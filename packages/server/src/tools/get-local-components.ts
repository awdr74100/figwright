import { specToToolDefinition, type ToolSpec } from './spec.js';

export const GET_LOCAL_COMPONENTS_TOOL_NAME = 'get_local_components';

export const getLocalComponentsTool: ToolSpec = {
  name: GET_LOCAL_COMPONENTS_TOOL_NAME,
  description:
    'Return all local components and component sets across the document as { components, componentSets }. ' +
    'Components carry their variantProperties (when part of a set); component sets carry their ' +
    'variantGroupProperties (available values per axis) and the ids of their variant components.',
  inputShape: {},
  kind: 'read',
};

export const getLocalComponentsToolDefinition = specToToolDefinition(getLocalComponentsTool);
