import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const ALIGN_NODES_TOOL_NAME = 'align_nodes';

const edge = z.enum(['MIN', 'CENTER', 'MAX']);

export const alignNodesTool: ToolSpec = {
  name: ALIGN_NODES_TOOL_NAME,
  description:
    "Align nodes to their parent's bounds or to each other, and/or space them evenly — Figma's " +
    'align / distribute toolbar. horizontal: MIN = left edge, CENTER, MAX = right edge; vertical: ' +
    'MIN = top, CENTER, MAX = bottom; either may be omitted to leave that axis alone. ' +
    'relativeTo PARENT (default) aligns each node within its own parent frame — the way to ' +
    '"centre this in its container" without computing x/y; SELECTION aligns the nodes to the ' +
    'bounding box they form together (line up a row on a shared top, or on a shared centre). ' +
    'distribute HORIZONTAL / VERTICAL keeps the outermost two nodes where they are and spaces ' +
    'the rest so the gaps between neighbours are equal (needs 3+ nodes; it cannot be combined ' +
    'with alignment on the same axis). Measures what each node covers, so a rotated node is ' +
    "centred by what you see; PARENT measures in the parent's own axes (left in a rotated frame " +
    "is that frame's left edge), SELECTION and distribute on the canvas. Refused, before anything " +
    'moves: an in-flow child of an auto-layout frame — the layout owns its position, so centre it ' +
    "with the parent's primaryAxisAlignItems / counterAxisAlignItems or its own layoutAlign " +
    '(set_auto_layout / set_layout_props), or set layoutPositioning ABSOLUTE first; a layer ' +
    'inside an instance (align the instance, or edit its main component); a node whose ancestor ' +
    'is in the same call (moving the ancestor already carries it). A repeated id is moved once. ' +
    'Returns { ok, affected }.',
  inputSchema: z.object({
    nodeIds: z.array(z.string()).min(1).describe('Nodes to align / distribute'),
    horizontal: edge.optional().describe('Horizontal alignment: MIN (left), CENTER or MAX (right)'),
    vertical: edge.optional().describe('Vertical alignment: MIN (top), CENTER or MAX (bottom)'),
    relativeTo: z
      .enum(['PARENT', 'SELECTION'])
      .optional()
      .describe(
        "PARENT (default): each node within its own parent's bounds. SELECTION: to the bounding " +
          'box of all the given nodes',
      ),
    distribute: z
      .enum(['HORIZONTAL', 'VERTICAL'])
      .optional()
      .describe('Equalise the gaps between nodes along this axis; needs 3+ nodes'),
  }),
  kind: 'write',
};
