import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const FLIP_NODES_TOOL_NAME = 'flip_nodes';

export const flipNodesTool: ToolSpec = {
  name: FLIP_NODES_TOOL_NAME,
  description:
    'Mirror nodes in place — Figma’s Flip horizontal / Flip vertical: HORIZONTAL swaps left and ' +
    'right on the canvas, VERTICAL top and bottom, each node about its own centre, so it stays ' +
    'where it was. A flipped node reads back flipped: true with its cssTransform. Flipping twice ' +
    'restores it. Returns { ok, affected }.',
  inputSchema: z.object({
    nodeIds: z.array(z.string()).min(1).describe('Node ids to flip'),
    axis: z.enum(['HORIZONTAL', 'VERTICAL']).describe('Which way to mirror'),
  }),
  kind: 'write',
};
