import { z } from 'zod';

import { specToToolDefinition, type ToolSpec } from './spec.js';

export const CREATE_TEXT_STYLE_TOOL_NAME = 'create_text_style';

export const createTextStyleTool: ToolSpec = {
  name: CREATE_TEXT_STYLE_TOOL_NAME,
  description:
    'Create a local text style. The font is loaded before assignment. lineHeight unit is ' +
    'AUTO / PIXELS / PERCENT (AUTO omits value); letterSpacing unit is PIXELS / PERCENT. ' +
    'Returns { ok, styleId, name }.',
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

export const createTextStyleToolDefinition = specToToolDefinition(createTextStyleTool);
