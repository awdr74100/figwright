import { z } from 'zod';

import { effectItemSchema } from './effect-schema.js';
import type { ToolSpec } from './spec.js';

export const SET_EFFECTS_TOOL_NAME = 'set_effects';

export const setEffectsTool: ToolSpec = {
  name: SET_EFFECTS_TOOL_NAME,
  description:
    "Set a node's effects. Shadows (DROP_SHADOW / INNER_SHADOW) need color + offset; blurs need " +
    'radius. Returns { ok, nodeId }.',
  inputShape: {
    nodeId: z.string().describe('Figma node id to apply effects to'),
    effects: z.array(effectItemSchema).describe('Effects to apply'),
  },
  kind: 'write',
};
