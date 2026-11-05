import { z } from 'zod';

import { fontNameSchema } from './font-name-schema.js';
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
    "Set a TEXT node's (or text on a path's) typography and layout/overflow properties. Typography: fontName " +
    "({ family, style?, variationSettings? } — variationSettings carries a variable font's axis " +
    'values, e.g. { wght: 650 }), fontSize, lineHeight, letterSpacing, textCase, textDecoration, ' +
    'paragraphSpacing / paragraphIndent (px between / indenting the paragraphs the text splits ' +
    'into at "\\n" — the write half of the same fields get_design_context reads), textWrapStyle ' +
    '(BALANCE evens the line lengths of a heading, PRETTY avoids an orphan last word — the same ' +
    'three values as CSS text-wrap) — these load the required fonts first. Alignment: ' +
    'textAlignHorizontal (CSS text-align; JUSTIFIED = justify) and textAlignVertical (where the ' +
    'text sits in a box taller than it — it only shows with a fixed height, textAutoResize NONE ' +
    'or WIDTH_AND_HEIGHT hugging leaves no slack). Layout/overflow: textTruncation (ellipsis), maxLines (line clamp), ' +
    'textAutoResize, and the box size: width alone wraps the text at that width and lets its ' +
    'height follow (auto-width text becomes auto height; a fixed box keeps its height), width + ' +
    'height make a fixed box, and height alone fixes the height at the current width — the way to ' +
    'size text, since resize_nodes leaves it a fixed box its wrapped lines can overflow. In auto ' +
    'layout a sized axis becomes FIXED, and a width / height passed replaces a variable bound to ' +
    'it, as resize_nodes does. A width / height that textAutoResize in the same call ' +
    'would undo (WIDTH_AND_HEIGHT; HEIGHT with a height) is refused. A box being fixed keeps the ' +
    'height its text showed: textAutoResize NONE / TRUNCATE on auto-sized text fixes it as it is, ' +
    'and with a width it is re-fitted there first (FigJam keeps a fixed text box at least as tall ' +
    'as its text). Any field may be omitted to leave it unchanged, ' +
    'with the one exception Figma imposes: maxLines (a line clamp) shows only on auto-sized text ' +
    'with textTruncation ENDING, so a box being fixed keeps its ellipsis but shows no line count ' +
    '(a fixed box truncates at its own edge), turning the ellipsis off clears it, and turning it ' +
    'on for auto-sized text sets it to 1. A maxLines the box would not show is refused. Text on a ' +
    'path (TEXT_PATH) takes fontName, fontSize, ' +
    'letterSpacing, textCase and the two alignments — on a path textAlignHorizontal anchors the ' +
    'text at its start point and textAlignVertical picks the side of the path; the line, ' +
    'paragraph, decoration and box fields are refused there. Inside an instance, whose layers ' +
    'Figma mostly will not resize, a box change that needs a resize (a size, fixing the box, ' +
    're-fitting it) is refused before anything is written, and in a batch so is one whose ' +
    'rollback would need it. Returns { ok, nodeId, ' +
    'width, height, adjusted? } — the size the text ends at, read back; adjusted says why the box ' +
    'is not what was asked (a min / max bound held its size, or Figma did not apply the mode or ' +
    'clamp).',
  inputSchema: z.object({
    nodeId: z.string().describe('TEXT node id'),
    // Typography (font load happens automatically when any of these is set)
    fontName: fontNameSchema.optional(),
    fontSize: z.number().positive().optional().describe('Font size in px'),
    lineHeight: lineHeight.optional(),
    letterSpacing: letterSpacing.optional(),
    paragraphSpacing: z
      .number()
      .min(0)
      .optional()
      .describe('Space between paragraphs in px (paragraphs split at "\\n")'),
    paragraphIndent: z
      .number()
      .min(0)
      .optional()
      .describe('First-line indent of each paragraph in px'),
    textWrapStyle: z
      .enum(['AUTO', 'BALANCE', 'PRETTY'])
      .optional()
      .describe('How each paragraph balances its line breaks; maps 1:1 to CSS text-wrap'),
    textCase: z
      .enum(['ORIGINAL', 'UPPER', 'LOWER', 'TITLE', 'SMALL_CAPS', 'SMALL_CAPS_FORCED'])
      .optional(),
    textDecoration: z.enum(['NONE', 'UNDERLINE', 'STRIKETHROUGH']).optional(),
    textAlignHorizontal: z
      .enum(['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED'])
      .optional()
      .describe('Horizontal alignment of the lines within the text box (CSS text-align)'),
    textAlignVertical: z
      .enum(['TOP', 'CENTER', 'BOTTOM'])
      .optional()
      .describe('Vertical alignment of the text within a box taller than its content'),
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
    width: z
      .number()
      .min(0.01)
      .optional()
      .describe('Text box width in px; the text wraps at it (auto-width text becomes auto height)'),
    height: z
      .number()
      .min(0.01)
      .optional()
      .describe('Text box height in px; fixes the box (textAutoResize NONE)'),
  }),
  kind: 'write',
};
