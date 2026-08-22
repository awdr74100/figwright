import { z } from 'zod';

import { gridItemSchema } from './grid-schema.js';
import type { ToolSpec } from './spec.js';

export const SET_LAYOUT_GRIDS_TOOL_NAME = 'set_layout_grids';

export const setLayoutGridsTool: ToolSpec = {
  name: SET_LAYOUT_GRIDS_TOOL_NAME,
  description:
    "Set a frame's own layout grids — the responsive column/row scaffold laid over it (the 12-column " +
    'grid, the 8pt baseline), distinct from auto-layout (set_auto_layout arranges children). Each ' +
    'grid is COLUMNS / ROWS (count + gutterSize + alignment, e.g. a 12-col grid) or GRID (uniform ' +
    "squares via sectionSize, a baseline). Replaces the frame's grids with the array given; pass [] " +
    'to clear them. Only frames (and components/instances) carry layout grids. Returns { ok, nodeId }.',
  inputSchema: z.object({
    nodeId: z.string().describe('Frame (or component/instance) node id'),
    grids: z
      .array(gridItemSchema)
      .describe('Layout grids to set; [] clears all grids on the frame'),
  }),
  kind: 'write',
};
