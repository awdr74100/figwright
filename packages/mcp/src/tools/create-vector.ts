import { z } from 'zod';

import { initialStyleShape } from './initial-props-schema.js';
import type { ToolSpec } from './spec.js';
import { vectorNetworkSchema, vectorPathsSchema } from './vector-schema.js';

export const CREATE_VECTOR_TOOL_NAME = 'create_vector';

export const createVectorTool: ToolSpec = {
  name: CREATE_VECTOR_TOOL_NAME,
  description:
    'Draw a vector — one editable VECTOR layer, no wrapper frame — from its geometry: ' +
    'vectorPaths (SVG path data in any syntax — an icon’s d attribute as is, arcs and relative ' +
    'commands included) or vectorNetwork (Figma’s ' +
    'own form, which can branch and carries per-vertex arrowheads and corner radii). Give exactly ' +
    'one. x / y place the drawing’s origin in the parent, so a point at (10, 4) lands at ' +
    '(x + 10, y + 4); Figma then fits the layer’s box to the drawing, which is where get_vector ' +
    'measures from afterwards. An open path needs strokes to be seen (pass strokes / strokeWeight ' +
    'here); a closed one takes fills. Then shape its stroke ' +
    'with set_complex_stroke (a brush, a hand-drawn wobble, a taper) or set text along it with ' +
    'create_text_path. For a whole SVG file use import_svg. Returns { ok, nodeId, name, type }.',
  inputSchema: z.object({
    parentId: z.string().optional().describe('Container node id; omit for current page'),
    name: z.string().optional().describe('Layer name'),
    x: z.number().optional().describe('Where the drawing’s x = 0 falls in the parent (default 0)'),
    y: z.number().optional().describe('Where the drawing’s y = 0 falls in the parent (default 0)'),
    vectorPaths: vectorPathsSchema.optional(),
    vectorNetwork: vectorNetworkSchema.optional(),
    ...initialStyleShape,
  }),
  kind: 'write',
};
