import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const ADD_VARIABLE_MODE_TOOL_NAME = 'add_variable_mode';

export const addVariableModeTool: ToolSpec = {
  name: ADD_VARIABLE_MODE_TOOL_NAME,
  description: 'Add a mode (e.g. "Dark") to a variable collection. Returns { ok, modeId, name }.',
  inputShape: {
    collectionId: z.string().describe('Variable collection id'),
    name: z.string().describe('Mode name, e.g. "Dark"'),
  },
  kind: 'write',
};
