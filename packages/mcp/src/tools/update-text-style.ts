import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const UPDATE_TEXT_STYLE_TOOL_NAME = 'update_text_style';

export const updateTextStyleTool: ToolSpec = {
  name: UPDATE_TEXT_STYLE_TOOL_NAME,
  description:
    'Update an existing text style (typography token) by id. Any of name / fontName / fontSize / ' +
    'lineHeight / letterSpacing / description may be omitted to leave unchanged. A new font is ' +
    'loaded before assignment. lineHeight unit is AUTO / PIXELS / PERCENT (AUTO omits value); ' +
    'letterSpacing unit is PIXELS / PERCENT. Use this to keep a shared style in sync with code ' +
    'instead of creating a duplicate. Returns { ok, styleId, name }.',
  inputShape: {
    styleId: z.string().describe('Text style id to update'),
    name: z.string().optional(),
    fontName: z.object({ family: z.string(), style: z.string() }).optional(),
    fontSize: z.number().optional(),
    lineHeight: z
      .object({ unit: z.enum(['AUTO', 'PIXELS', 'PERCENT']), value: z.number().optional() })
      .optional(),
    letterSpacing: z.object({ unit: z.enum(['PIXELS', 'PERCENT']), value: z.number() }).optional(),
    description: z.string().optional(),
  },
  kind: 'write',
};
