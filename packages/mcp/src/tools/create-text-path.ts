import { z } from 'zod';

import { fontNameSchema } from './font-name-schema.js';
import { fillPaintItemSchema } from './paint-schema.js';
import type { ToolSpec } from './spec.js';

export const CREATE_TEXT_PATH_TOOL_NAME = 'create_text_path';

export const createTextPathTool: ToolSpec = {
  name: CREATE_TEXT_PATH_TOOL_NAME,
  description:
    'Set text along a path (Figma Draw): turn a shape, line or vector into text that follows its ' +
    'outline — lettering round a badge or seal, a caption along a curve. The source is consumed ' +
    '(its fill and stroke go; the text is black unless fills says otherwise) and the result takes ' +
    'its place: same parent, stack position and spot on the canvas, under a NEW node id, returned. ' +
    'The path starts where its first segment does and runs clockwise: a rectangle at its top-left ' +
    'corner (4 segments, 8 when its corners are rounded), an ellipse at its rightmost point (4), a ' +
    'polygon or star at its top point (one per side), a line at its start (1), a vector along its ' +
    'own segments. startSegment / startPosition (0–1 along that segment) move the start. ' +
    'textAlignHorizontal anchors the text there — LEFT starts at it, CENTER centres on it, RIGHT ' +
    'ends at it; text running past either end of an open path is not drawn. textAlignVertical TOP ' +
    'sits the baseline on the path (the letters on the outside of a clockwise circle), BOTTOM hangs ' +
    'them on the other side, CENTER straddles it. Restyle it afterwards with set_text, ' +
    'set_text_properties and set_text_range (font, size, case, tracking, links, fills — text on a ' +
    'path has no line height, decoration, lists or box) and move its start with set_text_path. Not ' +
    'allowed inside a batch. Returns { ok, nodeId, name, type }.',
  inputSchema: z.object({
    nodeId: z.string().describe('The shape, line or vector to set the text along'),
    characters: z.string().min(1).describe('The text'),
    startSegment: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Index of the path segment the text starts on (default 0)'),
    startPosition: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe('How far along that segment it starts, 0–1 (default 0)'),
    fontName: fontNameSchema.optional(),
    fontSize: z.number().positive().optional().describe('Font size in px (default 12)'),
    fills: z.array(fillPaintItemSchema).optional().describe('Text fills (as set_fills)'),
    textAlignHorizontal: z
      .enum(['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED'])
      .optional()
      .describe('Where the text sits relative to its start (JUSTIFIED spreads it over the path)'),
    textAlignVertical: z
      .enum(['TOP', 'CENTER', 'BOTTOM'])
      .optional()
      .describe('Which side of the path the letters sit on'),
    name: z.string().optional().describe('Layer name (default: the text)'),
  }),
  kind: 'write',
};
