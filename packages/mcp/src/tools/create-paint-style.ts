import { z } from 'zod';

import { paintItemSchema } from './paint-schema.js';
import type { ToolSpec } from './spec.js';

export const CREATE_PAINT_STYLE_TOOL_NAME = 'create_paint_style';

export const createPaintStyleTool: ToolSpec = {
  name: CREATE_PAINT_STYLE_TOOL_NAME,
  description:
    'Create a reusable local paint (color) style from SOLID or gradient paints (same shape as ' +
    'set_fills); use slashes in the name for folder grouping. Apply it to nodes with ' +
    'apply_style_to_node, or edit it later with update_paint_style. Returns { ok, styleId, name }.',
  inputShape: {
    name: z.string().describe('Style name, e.g. "Brand/Primary"'),
    paints: z.array(paintItemSchema).describe('Paints'),
    description: z.string().optional().describe('Optional style description'),
  },
  kind: 'write',
};
