import { z } from 'zod';

import { effectItemSchema } from './effect-schema.js';
import { specToToolDefinition, type ToolSpec } from './spec.js';

export const CREATE_EFFECT_STYLE_TOOL_NAME = 'create_effect_style';

export const createEffectStyleTool: ToolSpec = {
  name: CREATE_EFFECT_STYLE_TOOL_NAME,
  description:
    'Create a local effect style. Shadows (DROP_SHADOW / INNER_SHADOW) need color + offset; ' +
    'blurs (LAYER_BLUR / BACKGROUND_BLUR) need radius. Returns { ok, styleId, name }.',
  inputShape: {
    name: z.string().describe('Style name, e.g. "Elevation/Card"'),
    effects: z.array(effectItemSchema),
    description: z.string().optional(),
  },
  kind: 'write',
};

export const createEffectStyleToolDefinition = specToToolDefinition(createEffectStyleTool);
