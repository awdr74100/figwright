import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const CREATE_RECTANGLE_TOOL_NAME = 'create_rectangle';

export const createRectangleTool: ToolSpec = {
  name: CREATE_RECTANGLE_TOOL_NAME,
  description:
    'Create a rectangle, optionally sized/positioned and appended to a parent (default: current ' +
    'page). Useful for solid shapes, dividers, and color blocks; for a container that holds other ' +
    'layers use create_frame, and for placed bitmaps use import_image. Returns ' +
    '{ ok, nodeId, name, type }.',
  inputShape: {
    parentId: z.string().optional().describe('Container node id; omit for current page'),
    name: z.string().optional().describe('Layer name'),
    x: z.number().optional().describe('X position in the parent'),
    y: z.number().optional().describe('Y position in the parent'),
    width: z.number().optional().describe('Width in px'),
    height: z.number().optional().describe('Height in px'),
  },
  kind: 'write',
};
