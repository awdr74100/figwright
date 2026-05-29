import { z } from 'zod';

import { specToToolDefinition, type ToolSpec } from './spec.js';

export const SET_CONSTRAINTS_TOOL_NAME = 'set_constraints';

const constraint = z.enum(['MIN', 'CENTER', 'MAX', 'STRETCH', 'SCALE']);

export const setConstraintsTool: ToolSpec = {
  name: SET_CONSTRAINTS_TOOL_NAME,
  description: "Set a node's resize constraints relative to its parent. Returns { ok, nodeId }.",
  inputShape: {
    nodeId: z.string(),
    horizontal: constraint,
    vertical: constraint,
  },
  kind: 'write',
};

export const setConstraintsToolDefinition = specToToolDefinition(setConstraintsTool);
