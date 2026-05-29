import { z } from 'zod';

import { paintItemSchema } from './paint-schema.js';
import { specToToolDefinition, type ToolSpec } from './spec.js';

export const UPDATE_PAINT_STYLE_TOOL_NAME = 'update_paint_style';

export const updatePaintStyleTool: ToolSpec = {
  name: UPDATE_PAINT_STYLE_TOOL_NAME,
  description:
    'Update an existing paint style by id. Any of name / paints / description may be omitted to ' +
    'leave unchanged. Returns { ok, styleId, name }.',
  inputShape: {
    styleId: z.string().describe('Paint style id to update'),
    name: z.string().optional(),
    paints: z.array(paintItemSchema).optional().describe('New paints (SOLID or gradient)'),
    description: z.string().optional(),
  },
  kind: 'write',
};

export const updatePaintStyleToolDefinition = specToToolDefinition(updatePaintStyleTool);
