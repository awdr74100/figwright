import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const ADD_VARIABLE_MODE_TOOL_NAME = 'add_variable_mode';

export const addVariableModeTool: ToolSpec = {
  name: ADD_VARIABLE_MODE_TOOL_NAME,
  description:
    'Add a mode (e.g. "Dark") to a variable collection. Returns { ok, modeId, name }. Mode count ' +
    "is gated by the file's Figma plan (Starter allows 1 per collection) — when the plan blocks a " +
    'new mode this fails with guidance: fall back to a paired collection (e.g. "Color/Dark") ' +
    "holding the same variable names with that theme's values.",
  inputShape: {
    collectionId: z.string().describe('Variable collection id'),
    name: z.string().describe('Mode name, e.g. "Dark"'),
  },
  kind: 'write',
};
