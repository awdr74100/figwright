import { z } from 'zod';

import { effectItemSchema } from './effect-schema.js';
import type { ToolSpec } from './spec.js';

export const UPDATE_EFFECT_STYLE_TOOL_NAME = 'update_effect_style';

export const updateEffectStyleTool: ToolSpec = {
  name: UPDATE_EFFECT_STYLE_TOOL_NAME,
  description:
    'Update an existing effect style by id. Any of name / effects / description may be omitted to ' +
    'leave unchanged; effects, when given, replaces the whole list. Shadows (DROP_SHADOW / ' +
    'INNER_SHADOW) need color + offset; blurs (LAYER_BLUR / BACKGROUND_BLUR) need radius. Use this ' +
    'to keep a shared style in sync with code instead of creating a duplicate. Returns { ok, ' +
    'styleId, name }.',
  inputShape: {
    styleId: z.string().describe('Effect style id to update'),
    name: z.string().optional(),
    effects: z.array(effectItemSchema).optional().describe('New effects (replaces all)'),
    description: z.string().optional(),
  },
  kind: 'write',
};
