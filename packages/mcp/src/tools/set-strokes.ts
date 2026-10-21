import { z } from 'zod';

import { fillPaintItemSchema } from './paint-schema.js';
import type { ToolSpec } from './spec.js';

export const SET_STROKES_TOOL_NAME = 'set_strokes';

export const setStrokesTool: ToolSpec = {
  name: SET_STROKES_TOOL_NAME,
  description:
    "Set a node's strokes (SOLID, gradient or PATTERN paints, same shape as set_fills) plus optional " +
    'strokeWeight, strokeAlign (INSIDE / OUTSIDE / CENTER), dashPattern (dashes), and per-side ' +
    'weights (strokeTopWeight / strokeRightWeight / strokeBottomWeight / strokeLeftWeight — for ' +
    'nodes that support individual stroke weights, e.g. a border-bottom-only divider). A per-side ' +
    'weight overrides strokeWeight for that side. strokeCap shapes the ends of an open path or line ' +
    '— ROUND for a pen line, an ARROW / TRIANGLE / DIAMOND / CIRCLE cap for an arrowhead or a ' +
    'connector end — on every open end, so an arrow cap on a line heads both ends; for one ' +
    'arrowhead draw it with create_vector’s vectorNetwork, the cap on its end vertex. strokeJoin ' +
    '(MITER / BEVEL / ROUND) shapes the corners, strokeMiterLimit (1–16) how long a MITER corner ' +
    'may get before it is bevelled. Any field may be omitted to leave it unchanged. ' +
    'Brushes, dynamic strokes and width profiles are set_complex_stroke. ' +
    'Returns { ok, nodeId }.',
  inputSchema: z.object({
    nodeId: z.string().describe('Figma node id'),
    strokes: z.array(fillPaintItemSchema).describe('Stroke paints'),
    strokeWeight: z.number().min(0).optional().describe('Uniform stroke thickness in px'),
    strokeAlign: z
      .enum(['INSIDE', 'OUTSIDE', 'CENTER'])
      .optional()
      .describe('Stroke position relative to the geometry'),
    dashPattern: z
      .array(z.number().min(0))
      .optional()
      .describe('Dash/gap lengths in px, e.g. [4, 2]; [] for a solid stroke'),
    strokeCap: z
      .enum([
        'NONE',
        'ROUND',
        'SQUARE',
        'ARROW_LINES',
        'ARROW_EQUILATERAL',
        'DIAMOND_FILLED',
        'TRIANGLE_FILLED',
        'CIRCLE_FILLED',
      ])
      .optional()
      .describe('The ends of an open path or line: a line cap, or an arrowhead'),
    strokeJoin: z.enum(['MITER', 'BEVEL', 'ROUND']).optional().describe('How corners are drawn'),
    strokeMiterLimit: z
      .number()
      .min(1)
      .max(16)
      .optional()
      .describe(
        'How long a MITER corner may get, as a multiple of the stroke weight, before it is bevelled',
      ),
    strokeTopWeight: z.number().min(0).optional().describe('Top side weight in px'),
    strokeRightWeight: z.number().min(0).optional().describe('Right side weight in px'),
    strokeBottomWeight: z.number().min(0).optional().describe('Bottom side weight in px'),
    strokeLeftWeight: z.number().min(0).optional().describe('Left side weight in px'),
  }),
  kind: 'write',
};
