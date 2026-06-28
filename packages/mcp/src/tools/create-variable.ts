import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const CREATE_VARIABLE_TOOL_NAME = 'create_variable';

export const createVariableTool: ToolSpec = {
  name: CREATE_VARIABLE_TOOL_NAME,
  description:
    'Create a variable in a collection with resolvedType BOOLEAN / FLOAT / STRING / COLOR. The ' +
    'variable starts empty — set per-mode values with set_variable_value, then attach it with ' +
    'bind_variable_to_node or bind_variable_to_paint. Returns { ok, variableId, name }.',
  inputShape: {
    name: z.string().describe('Variable name, e.g. "color/primary"'),
    collectionId: z.string().describe('Variable collection id'),
    resolvedType: z.enum(['BOOLEAN', 'FLOAT', 'STRING', 'COLOR']).describe('Variable data type'),
  },
  kind: 'write',
};
