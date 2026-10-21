import { z } from 'zod';

import { fillPaintItemSchema } from './paint-schema.js';
import type { ToolSpec } from './spec.js';

export const SET_FILLS_TOOL_NAME = 'set_fills';

export const setFillsTool: ToolSpec = {
  name: SET_FILLS_TOOL_NAME,
  description:
    "Set a node's fills. SOLID: { type:'SOLID', color:{r,g,b} } (0–1). Gradient: " +
    "{ type:'GRADIENT_LINEAR'|…, gradientStops:[{position,color:{r,g,b,a}}], gradientTransform } " +
    '(round-trips get_node output). A SOLID paint may carry boundVariables ({ color: variableId }) ' +
    'and a gradient stop its own — the paint then tracks that variable instead of the literal. ' +
    "Channels are in the document's colour space; a colour taken from code adds space: 'SRGB' so a " +
    'Display P3 file shows it as the code does. PATTERN tiles another layer across the fill: ' +
    "{ type:'PATTERN', sourceNodeId, tileType, scalingFactor, spacing, horizontalAlignment, " +
    'verticalAlignment } (round-trips get_node output; omitted fields take the defaults). Images ' +
    'go in with set_image_fill. Returns { ok, nodeId }.',
  inputSchema: z.object({
    nodeId: z.string().describe('Figma node id to repaint'),
    fills: z.array(fillPaintItemSchema).describe('Paints to apply'),
  }),
  kind: 'write',
};
