import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const DELETE_VARIABLE_TOOL_NAME = 'delete_variable';

export const deleteVariableTool: ToolSpec = {
  name: DELETE_VARIABLE_TOOL_NAME,
  description:
    'Delete a single variable by id; any node or paint bound to it reverts to its raw value. To ' +
    'delete an entire collection and all its variables use delete_variable_collection. Returns ' +
    '{ ok, variableId, name }.',
  inputShape: {
    variableId: z.string().describe('Variable id to delete'),
  },
  kind: 'write',
};
