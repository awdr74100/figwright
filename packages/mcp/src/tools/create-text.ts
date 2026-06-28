import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const CREATE_TEXT_TOOL_NAME = 'create_text';

export const createTextTool: ToolSpec = {
  name: CREATE_TEXT_TOOL_NAME,
  description:
    'Create a new TEXT node with the given characters (default font loaded automatically), ' +
    'optionally sized/positioned and appended to a parent (default: current page). To change the ' +
    'text of an existing node use set_text; for font, size, or color use set_text_properties. ' +
    'Returns { ok, nodeId, name, type }.',
  inputShape: {
    characters: z.string().describe('Text content'),
    parentId: z.string().optional().describe('Container node id; omit for current page'),
    x: z.number().optional().describe('X position in the parent'),
    y: z.number().optional().describe('Y position in the parent'),
    fontSize: z.number().optional().describe('Font size in px'),
  },
  kind: 'write',
};
