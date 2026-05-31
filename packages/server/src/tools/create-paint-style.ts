import { z } from 'zod';

import { paintItemSchema } from './paint-schema.js';
import type { ToolSpec } from './spec.js';

export const CREATE_PAINT_STYLE_TOOL_NAME = 'create_paint_style';

export const createPaintStyleTool: ToolSpec = {
  name: CREATE_PAINT_STYLE_TOOL_NAME,
  description:
    'Create a local paint (color) style. SOLID or gradient paints (same shape as set_fills). ' +
    'Use a/b/c slashes in the name for folder grouping. Returns { ok, styleId, name }.',
  inputShape: {
    name: z.string().describe('Style name, e.g. "Brand/Primary"'),
    paints: z.array(paintItemSchema).describe('Paints'),
    description: z.string().optional().describe('Optional style description'),
  },
  kind: 'write',
};
