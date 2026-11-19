import { z } from 'zod';

import {
  DOCUMENTATION_LINKS_DESCRIPTION,
  documentationLinksSchema,
} from './documentation-schema.js';
import { paintItemSchema } from './paint-schema.js';
import type { ToolSpec } from './spec.js';

export const UPDATE_PAINT_STYLE_TOOL_NAME = 'update_paint_style';

export const updatePaintStyleTool: ToolSpec = {
  name: UPDATE_PAINT_STYLE_TOOL_NAME,
  description:
    'Update an existing paint style by id. Any of name / paints / description may be omitted to ' +
    'leave unchanged. Because paints replace wholesale, a paint written back WITHOUT its ' +
    'boundVariables clears the variable it was bound to — re-send the binding, or change the ' +
    'variable itself instead. documentationLinks may be given too ([] removes the link). A call ' +
    'that fails part-way leaves the style as it was. Returns { ok, styleId, name, adjusted? } — ' +
    'adjusted says when the link was stored differently from what was sent.',
  inputSchema: z.object({
    styleId: z.string().describe('Paint style id to update'),
    name: z.string().optional(),
    paints: z.array(paintItemSchema).optional().describe('New paints (SOLID or gradient)'),
    description: z.string().optional(),
    documentationLinks: documentationLinksSchema
      .optional()
      .describe(DOCUMENTATION_LINKS_DESCRIPTION),
  }),
  kind: 'write',
};
