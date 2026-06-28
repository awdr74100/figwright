import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const CREATE_TEXT_STYLE_TOOL_NAME = 'create_text_style';

export const createTextStyleTool: ToolSpec = {
  name: CREATE_TEXT_STYLE_TOOL_NAME,
  description:
    'Create a reusable local text style (a typography token) that can be applied to TEXT nodes with ' +
    'apply_style_to_node. The font is loaded before assignment. lineHeight unit is AUTO / PIXELS / ' +
    'PERCENT (AUTO omits value); letterSpacing unit is PIXELS / PERCENT. For one-off formatting of a ' +
    'single node use set_text_properties instead. Returns { ok, styleId, name }.',
  inputShape: {
    name: z.string().describe('Style name, e.g. "Heading/H1"'),
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
