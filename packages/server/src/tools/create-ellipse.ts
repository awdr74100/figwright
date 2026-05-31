import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const CREATE_ELLIPSE_TOOL_NAME = 'create_ellipse';

export const createEllipseTool: ToolSpec = {
  name: CREATE_ELLIPSE_TOOL_NAME,
  description:
    'Create an ellipse, optionally sized / named / positioned and placed under a parent (default: ' +
    'current page). Returns { ok, nodeId, name, type }.',
  inputShape: {
    parentId: z.string().optional().describe('Parent node id (default: current page)'),
    name: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  },
  kind: 'write',
};
