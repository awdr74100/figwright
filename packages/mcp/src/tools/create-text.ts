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
    'A new text is auto width: pass width to wrap it at a set width with its height following the ' +
    'text (a paragraph, a line centred across a column), and width + height for a fixed box — in ' +
    'this call rather than resize_nodes afterwards, which leaves a fixed box its wrapped lines can ' +
    'overflow. width / height cannot be combined with a layoutSizing* HUG / FILL on the same axis, ' +
    'which sizes it instead. Returns { ok, nodeId, name, type, width, height } — the size the text ' +
    'came out at.',
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
