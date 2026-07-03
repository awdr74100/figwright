import { z } from 'zod';

import { paintItemSchema } from './paint-schema.js';
import type { ToolSpec } from './spec.js';

export const SET_TEXT_RANGE_TOOL_NAME = 'set_text_range';

// One character range plus the per-run properties to apply to it — the write-side mirror of a read
// segment. All props are optional; only those given are changed. `start`/`end` are char offsets into
// the node's `characters` (end exclusive). Ranges apply in array order, so a later range overrides an
// earlier one where they overlap.
const rangeSchema = z.object({
  start: z.number().describe('Start char offset (inclusive)'),
  end: z.number().describe('End char offset (exclusive)'),
  fontName: z
    .object({ family: z.string(), style: z.string() })
    .optional()
    .describe('e.g. { family: "Inter", style: "Bold" } — makes the run bold/italic'),
  fontSize: z.number().optional(),
  fills: z
    .array(paintItemSchema)
    .optional()
    .describe('Run colour (SOLID or gradient), like set_fills'),
  textDecoration: z.enum(['NONE', 'UNDERLINE', 'STRIKETHROUGH']).optional(),
  textCase: z
    .enum(['ORIGINAL', 'UPPER', 'LOWER', 'TITLE', 'SMALL_CAPS', 'SMALL_CAPS_FORCED'])
    .optional(),
  lineHeight: z
    .union([
      z.object({ unit: z.literal('AUTO') }),
      z.object({ unit: z.enum(['PIXELS', 'PERCENT']), value: z.number() }),
    ])
    .optional(),
  letterSpacing: z.object({ unit: z.enum(['PIXELS', 'PERCENT']), value: z.number() }).optional(),
  hyperlink: z
    .union([z.object({ type: z.enum(['URL', 'NODE']), value: z.string() }), z.null()])
    .optional()
    .describe('Make the run a link ({ type, value }); null clears it'),
  listOptions: z
    .enum(['ORDERED', 'UNORDERED', 'NONE'])
    .optional()
    .describe('Turn the run into an ordered/unordered list item; NONE clears it'),
  indentation: z.number().optional().describe('List / block indentation depth'),
  textStyleId: z.string().optional().describe('Bind the run to a shared text style (its id)'),
  fillStyleId: z.string().optional().describe('Bind the run to a shared fill style (its id)'),
  boundVariables: z
    .record(z.string(), z.union([z.string(), z.null()]))
    .optional()
    .describe(
      'Per-run variable bindings: { field: variableId }; null unbinds. `fills` binds a COLOR variable ' +
        'onto the run (a colour token on an inline link); other fields (fontSize / lineHeight / ' +
        'letterSpacing / fontFamily / fontStyle / fontWeight / paragraphSpacing / paragraphIndent) bind a token',
    ),
});

export const setTextRangeTool: ToolSpec = {
  name: SET_TEXT_RANGE_TOOL_NAME,
  description:
    'Style character ranges of an existing TEXT node — the write-side mirror of a read segment, for ' +
    'inline rich text (a link inside a sentence, a bold word, a coloured span, a bulleted list, a ' +
    "smaller /mo after a price). Each range gives start/end (char offsets into the node's characters) " +
    'plus any subset of run properties: fontName / fontSize / fills / textDecoration / textCase / ' +
    'lineHeight / letterSpacing / hyperlink / listOptions / indentation, and design-system bindings ' +
    'textStyleId / fillStyleId / boundVariables. Ranges apply in order (a later range overrides an ' +
    'earlier one on overlap). Fonts are loaded automatically. Set the whole node first with create_text ' +
    '/ set_text; use set_text_properties for node-level typography & overflow. Returns { ok, nodeId }.',
  inputShape: {
    nodeId: z.string().describe('TEXT node id whose ranges to style'),
    ranges: z.array(rangeSchema).describe('Character ranges + the run properties to apply to each'),
  },
  kind: 'write',
};
