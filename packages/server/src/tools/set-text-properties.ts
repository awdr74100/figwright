import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_TEXT_PROPERTIES_TOOL_NAME = 'set_text_properties';

// A Figma LineHeight: AUTO carries no value; PIXELS/PERCENT do. LetterSpacing is always unit+value.
const lineHeight = z
  .union([
    z.object({ unit: z.literal('AUTO') }),
    z.object({ unit: z.enum(['PIXELS', 'PERCENT']), value: z.number() }),
  ])
  .describe('Line height: { unit: "AUTO" } or { unit: "PIXELS" | "PERCENT", value }');

const letterSpacing = z
  .object({ unit: z.enum(['PIXELS', 'PERCENT']), value: z.number() })
  .describe('Letter spacing: { unit: "PIXELS" | "PERCENT", value }');

export const setTextPropertiesTool: ToolSpec = {
  name: SET_TEXT_PROPERTIES_TOOL_NAME,
  description:
    "Set a TEXT node's typography and layout/overflow properties. Typography: fontName " +
    '({ family, style }), fontSize, lineHeight, letterSpacing, textCase, textDecoration — these ' +
    'load the required fonts first. Layout/overflow: textTruncation (ellipsis), maxLines (line ' +
    'clamp), textAutoResize. Any field may be omitted to leave it unchanged. maxLines applies when ' +
    'textTruncation is ENDING. Returns { ok, nodeId }.',
  inputShape: {
    nodeId: z.string().describe('TEXT node id'),
    // Typography (font load happens automatically when any of these is set)
    fontName: z
      .object({ family: z.string(), style: z.string() })
      .optional()
      .describe('Font family + style, e.g. { family: "Inter", style: "Bold" }'),
    fontSize: z.number().positive().optional().describe('Font size in px'),
    lineHeight: lineHeight.optional(),
    letterSpacing: letterSpacing.optional(),
    textCase: z
      .enum(['ORIGINAL', 'UPPER', 'LOWER', 'TITLE', 'SMALL_CAPS', 'SMALL_CAPS_FORCED'])
      .optional(),
    textDecoration: z.enum(['NONE', 'UNDERLINE', 'STRIKETHROUGH']).optional(),
    // Layout / overflow (no font load needed)
    textTruncation: z
      .enum(['DISABLED', 'ENDING'])
      .optional()
      .describe('ENDING truncates with an ellipsis'),
    maxLines: z
      .number()
      .nullable()
      .optional()
      .describe('Max lines before truncation; null = unlimited'),
    textAutoResize: z
      .enum(['NONE', 'HEIGHT', 'WIDTH_AND_HEIGHT', 'TRUNCATE'])
      .optional()
      .describe('How the text box resizes to its content'),
  },
  kind: 'write',
};
