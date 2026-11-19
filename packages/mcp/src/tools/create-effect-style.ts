import { z } from 'zod';

import {
  DOCUMENTATION_LINKS_DESCRIPTION,
  documentationLinksSchema,
} from './documentation-schema.js';
import { effectItemSchema } from './effect-schema.js';
import type { ToolSpec } from './spec.js';

export const CREATE_EFFECT_STYLE_TOOL_NAME = 'create_effect_style';

export const createEffectStyleTool: ToolSpec = {
  name: CREATE_EFFECT_STYLE_TOOL_NAME,
  description:
    'Create a local effect style. Shadows (DROP_SHADOW / INNER_SHADOW) need color + offset; ' +
    'blurs (LAYER_BLUR / BACKGROUND_BLUR) need radius. Optionally with a documentation link. ' +
    'Returns { ok, styleId, name, adjusted? } — adjusted says when the link was stored differently ' +
    'from what was sent.',
  inputSchema: z.object({
    name: z.string().describe('Style name, e.g. "Elevation/Card"'),
    effects: z.array(effectItemSchema),
    description: z.string().optional(),
    documentationLinks: documentationLinksSchema
      .optional()
      .describe(DOCUMENTATION_LINKS_DESCRIPTION),
  }),
  kind: 'write',
};
