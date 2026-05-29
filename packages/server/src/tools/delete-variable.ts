import { z } from 'zod';

import { specToToolDefinition, type ToolSpec } from './spec.js';

export const DELETE_VARIABLE_TOOL_NAME = 'delete_variable';

export const deleteVariableTool: ToolSpec = {
  name: DELETE_VARIABLE_TOOL_NAME,
  description: 'Delete a variable by id. Returns { ok, variableId, name }.',
  inputShape: {
    variableId: z.string().describe('Variable id to delete'),
  },
  kind: 'write',
};

export const deleteVariableToolDefinition = specToToolDefinition(deleteVariableTool);
