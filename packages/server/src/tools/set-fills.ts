import { z } from 'zod';

import { paintItemSchema } from './paint-schema.js';
import type { ToolSpec } from './spec.js';

export const SET_FILLS_TOOL_NAME = 'set_fills';

export const setFillsTool: ToolSpec = {
  name: SET_FILLS_TOOL_NAME,
  description:
    "Set a node's fills. SOLID: { type:'SOLID', color:{r,g,b} } (0–1). Gradient: " +
    "{ type:'GRADIENT_LINEAR'|…, gradientStops:[{position,color:{r,g,b,a}}], gradientTransform } " +
    '(round-trips get_node output). Returns { ok, nodeId }.',
  inputShape: {
    nodeId: z.string().describe('Figma node id to repaint'),
    fills: z.array(paintItemSchema).describe('Paints to apply'),
  },
  kind: 'write',
};
