import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const CREATE_ELLIPSE_TOOL_NAME = 'create_ellipse';

export const createEllipseTool: ToolSpec = {
  name: CREATE_ELLIPSE_TOOL_NAME,
  description:
    'Create an ellipse (a circle when width equals height), optionally sized/named/positioned under ' +
    'a parent (default: current page). To turn it into a pie, arc, or ring afterwards use set_arc. ' +
    'Returns { ok, nodeId, name, type }.',
  inputShape: {
    parentId: z.string().optional().describe('Parent node id (default: current page)'),
    name: z.string().optional().describe('Layer name'),
    x: z.number().optional().describe('X position in the parent'),
    y: z.number().optional().describe('Y position in the parent'),
    width: z.number().optional().describe('Width in px'),
    height: z.number().optional().describe('Height in px'),
  },
  kind: 'write',
};
