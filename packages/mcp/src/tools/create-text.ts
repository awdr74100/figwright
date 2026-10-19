import { z } from 'zod';

import { initialStyleShape, initialTextShape } from './initial-props-schema.js';
import type { ToolSpec } from './spec.js';

export const CREATE_TEXT_TOOL_NAME = 'create_text';

export const createTextTool: ToolSpec = {
  name: CREATE_TEXT_TOOL_NAME,
  description:
    'Create a new TEXT node with the given characters (default font loaded automatically), ' +
    'optionally sized/positioned and appended to a parent (default: current page). To change the ' +
    'text of an existing node use set_text. Typography (fontName, fontSize, lineHeight, ' +
    'textAlignHorizontal, …) takes the same fields as set_text_properties, and fills the text ' +
    'colour (as set_fills), all in this call — set the real font here, a new node is Inter. ' +
    'Returns { ok, nodeId, name, type }.',
  inputSchema: z.object({
    characters: z.string().describe('Text content'),
    parentId: z.string().optional().describe('Container node id; omit for current page'),
    x: z.number().optional().describe('X position in the parent'),
    y: z.number().optional().describe('Y position in the parent'),
    ...initialTextShape,
    fills: initialStyleShape.fills,
    layoutSizingHorizontal: initialStyleShape.layoutSizingHorizontal,
    layoutSizingVertical: initialStyleShape.layoutSizingVertical,
  }),
  kind: 'write',
};
