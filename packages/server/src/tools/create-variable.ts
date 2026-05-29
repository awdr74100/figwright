import { z } from 'zod';

import { specToToolDefinition, type ToolSpec } from './spec.js';

export const CREATE_VARIABLE_TOOL_NAME = 'create_variable';

export const createVariableTool: ToolSpec = {
  name: CREATE_VARIABLE_TOOL_NAME,
  description:
    'Create a variable in a collection. resolvedType is BOOLEAN / FLOAT / STRING / COLOR. ' +
    'Use set_variable_value to populate per-mode values. Returns { ok, variableId, name }.',
  inputShape: {
    name: z.string().describe('Variable name, e.g. "color/primary"'),
    collectionId: z.string().describe('Variable collection id'),
    resolvedType: z.enum(['BOOLEAN', 'FLOAT', 'STRING', 'COLOR']),
  },
  kind: 'write',
};

export const createVariableToolDefinition = specToToolDefinition(createVariableTool);
