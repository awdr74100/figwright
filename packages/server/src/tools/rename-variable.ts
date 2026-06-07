import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const RENAME_VARIABLE_TOOL_NAME = 'rename_variable';

export const renameVariableTool: ToolSpec = {
  name: RENAME_VARIABLE_TOOL_NAME,
  description:
    'Rename a variable (e.g. "color/primary" → "color/brand"). Returns { ok, variableId, name }.',
  inputShape: {
    variableId: z.string().describe('Variable id'),
    name: z.string().describe('New variable name, e.g. "color/brand"'),
  },
  kind: 'write',
};
