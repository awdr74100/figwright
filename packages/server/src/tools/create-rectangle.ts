import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const CREATE_RECTANGLE_TOOL_NAME = 'create_rectangle';

export const createRectangleTool: ToolSpec = {
  name: CREATE_RECTANGLE_TOOL_NAME,
  description:
    'Create a rectangle, optionally sized/positioned and appended to a parent (else the current page). ' +
    'Returns { ok, nodeId, name, type }.',
  inputShape: {
    parentId: z.string().optional().describe('Container node id; omit for current page'),
    name: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  },
  kind: 'write',
};
