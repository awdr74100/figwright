import { z } from 'zod';

import { paintItemSchema } from './paint-schema.js';
import type { ToolSpec } from './spec.js';

export const SET_STROKES_TOOL_NAME = 'set_strokes';

export const setStrokesTool: ToolSpec = {
  name: SET_STROKES_TOOL_NAME,
  description:
    "Set a node's strokes (SOLID or gradient paints, same shape as set_fills) plus optional " +
    'strokeWeight, strokeAlign (INSIDE / OUTSIDE / CENTER), dashPattern (dashes), and per-side ' +
    'weights (strokeTopWeight / strokeRightWeight / strokeBottomWeight / strokeLeftWeight — for ' +
    'nodes that support individual stroke weights, e.g. a border-bottom-only divider). A per-side ' +
    'weight overrides strokeWeight for that side. Any field may be omitted to leave it unchanged. ' +
    'Returns { ok, nodeId }.',
  inputShape: {
    nodeId: z.string().describe('Figma node id'),
    strokes: z.array(paintItemSchema).describe('Stroke paints'),
    strokeWeight: z.number().min(0).optional().describe('Uniform stroke thickness in px'),
    strokeAlign: z
      .enum(['INSIDE', 'OUTSIDE', 'CENTER'])
      .optional()
      .describe('Stroke position relative to the geometry'),
    dashPattern: z
      .array(z.number().min(0))
      .optional()
      .describe('Dash/gap lengths in px, e.g. [4, 2]; [] for a solid stroke'),
    strokeTopWeight: z.number().min(0).optional().describe('Top side weight in px'),
    strokeRightWeight: z.number().min(0).optional().describe('Right side weight in px'),
    strokeBottomWeight: z.number().min(0).optional().describe('Bottom side weight in px'),
    strokeLeftWeight: z.number().min(0).optional().describe('Left side weight in px'),
  },
  kind: 'write',
};
