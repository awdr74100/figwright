import { z } from 'zod';

import { specToToolDefinition, type ToolSpec } from './spec.js';

export const CREATE_VARIABLE_COLLECTION_TOOL_NAME = 'create_variable_collection';

export const createVariableCollectionTool: ToolSpec = {
  name: CREATE_VARIABLE_COLLECTION_TOOL_NAME,
  description:
    'Create a variable collection. Figma auto-creates a default mode. ' +
    'Returns { ok, collectionId, defaultModeId, name }.',
  inputShape: {
    name: z.string().describe('Collection name, e.g. "Theme"'),
  },
  kind: 'write',
};

export const createVariableCollectionToolDefinition = specToToolDefinition(
  createVariableCollectionTool,
);
