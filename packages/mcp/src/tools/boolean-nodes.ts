import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const BOOLEAN_NODES_TOOL_NAME = 'boolean_nodes';

export const booleanNodesTool: ToolSpec = {
  name: BOOLEAN_NODES_TOOL_NAME,
  description:
    'Combine shapes into one editable boolean group: UNION merges them, SUBTRACT cuts the upper ' +
    'layers out of the lowest one (a ring from a circle and a smaller circle; the order is the ' +
    'layer stacking, not the order of nodeIds), INTERSECT keeps only the overlap, EXCLUDE keeps ' +
    'everything except the overlap. Like Figma’s own Boolean command, the result takes the ' +
    'fill and effects (or the fill / effect style) of the topmost operand — of the lowest for ' +
    'SUBTRACT — and no stroke; set_strokes on the result if it needs one. ' +
    'The operands stay inside the result as its children, so it ' +
    'can still be unpicked; use flatten_nodes to bake it into one vector. The nodes must share ' +
    'a parent, and the result takes their place there. Needs at least 2 distinct nodes. Not allowed ' +
    'inside a batch. Returns { ok, nodeId, name, type }.',
  inputSchema: z.object({
    operation: z.enum(['UNION', 'SUBTRACT', 'INTERSECT', 'EXCLUDE']),
    nodeIds: z.array(z.string()).min(2).describe('Shapes to combine (2 or more, one parent)'),
    name: z.string().optional().describe('Name for the resulting layer'),
  }),
  kind: 'write',
};
