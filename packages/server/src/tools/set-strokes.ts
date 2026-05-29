import { z } from 'zod';

import { paintItemSchema } from './paint-schema.js';
import type { ToolSpec } from './spec.js';

export const SET_STROKES_TOOL_NAME = 'set_strokes';

export const setStrokesTool: ToolSpec = {
  name: SET_STROKES_TOOL_NAME,
  description:
    "Set a node's strokes (SOLID or gradient paints, same shape as set_fills) and optional strokeWeight. Returns { ok, nodeId }.",
  inputShape: {
    nodeId: z.string().describe('Figma node id'),
    strokes: z.array(paintItemSchema).describe('Stroke paints'),
    strokeWeight: z.number().min(0).optional().describe('Stroke thickness in px'),
  },
  kind: 'write',
};
