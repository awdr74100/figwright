import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const OUTLINE_STROKE_TOOL_NAME = 'outline_stroke';

export const outlineStrokeTool: ToolSpec = {
  name: OUTLINE_STROKE_TOOL_NAME,
  description:
    'Outline a node’s stroke — Figma’s Outline Stroke: a new VECTOR (a GROUP of glyph outlines ' +
    'for text) whose filled shape is exactly what the stroke draws — a brush, a hand-drawn wobble, ' +
    'a taper and dashes included — so it can be recoloured, combined with boolean_nodes, edited ' +
    'point by point (get_vector / set_vector) or exported as plain vector art. It is filled with ' +
    'the stroke’s paints and keeps the node’s opacity, blend mode and effects; the node’s own ' +
    'fills are not part of it. It lands directly above the node, at the same spot — above the ' +
    'instance, boolean or repeat group holding the node, which cannot take it, and absolutely ' +
    'positioned in an auto-layout frame so nothing re-flows. The node itself stays; delete_nodes ' +
    'it to replace it. A scatter brush outlines into thousands of shapes. Returns { ok, nodeId, ' +
    'name, type } for the outline.',
  inputSchema: z.object({
    nodeId: z.string().describe('A node with a visible stroke'),
    name: z.string().optional().describe('Name for the outline'),
  }),
  kind: 'write',
};
