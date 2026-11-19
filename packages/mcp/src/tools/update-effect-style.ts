import { z } from 'zod';

import {
  DOCUMENTATION_LINKS_DESCRIPTION,
  documentationLinksSchema,
} from './documentation-schema.js';
import { effectItemSchema } from './effect-schema.js';
import type { ToolSpec } from './spec.js';

export const UPDATE_EFFECT_STYLE_TOOL_NAME = 'update_effect_style';

export const updateEffectStyleTool: ToolSpec = {
  name: UPDATE_EFFECT_STYLE_TOOL_NAME,
  description:
    'Update an existing effect style by id. Any of name / effects / description may be omitted to ' +
    'leave unchanged; effects, when given, replaces the whole list. Shadows (DROP_SHADOW / ' +
    'INNER_SHADOW) need color + offset; blurs (LAYER_BLUR / BACKGROUND_BLUR) need radius. Use this ' +
    'to keep a shared style in sync with code instead of creating a duplicate. Because effects ' +
    'replace wholesale, an effect written back WITHOUT its boundVariables clears the variables it ' +
    'was bound to — re-send them, or change the variable itself instead. documentationLinks may ' +
    'be given too ([] removes the link). A call that fails part-way leaves the style as it was. ' +
    'Returns { ok, styleId, name, adjusted? } — adjusted says when the link was stored differently ' +
    'from what was sent.',
  inputSchema: z.object({
    styleId: z.string().describe('Effect style id to update'),
    name: z.string().optional(),
    effects: z.array(effectItemSchema).optional().describe('New effects (replaces all)'),
    description: z.string().optional(),
    documentationLinks: documentationLinksSchema
      .optional()
      .describe(DOCUMENTATION_LINKS_DESCRIPTION),
  }),
  kind: 'write',
};
