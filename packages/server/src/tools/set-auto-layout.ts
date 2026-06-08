import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_AUTO_LAYOUT_TOOL_NAME = 'set_auto_layout';

export const setAutoLayoutTool: ToolSpec = {
  name: SET_AUTO_LAYOUT_TOOL_NAME,
  description:
    "Configure a frame's auto layout. layoutMode NONE disables it; HORIZONTAL/VERTICAL enable flex " +
    '(padding / itemSpacing / alignment / wrap); GRID enables CSS-Grid-style layout ' +
    '(padding / gridRowCount / gridColumnCount / gridRowGap / gridColumnGap). Returns { ok, nodeId }.',
  inputShape: {
    nodeId: z.string(),
    layoutMode: z.enum(['NONE', 'HORIZONTAL', 'VERTICAL', 'GRID']),
    paddingTop: z.number().optional(),
    paddingRight: z.number().optional(),
    paddingBottom: z.number().optional(),
    paddingLeft: z.number().optional(),
    // HORIZONTAL / VERTICAL
    itemSpacing: z.number().optional(),
    primaryAxisAlignItems: z.enum(['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN']).optional(),
    counterAxisAlignItems: z.enum(['MIN', 'CENTER', 'MAX', 'BASELINE']).optional(),
    layoutWrap: z.enum(['NO_WRAP', 'WRAP']).optional(),
    // GRID
    gridRowCount: z.number().int().positive().optional(),
    gridColumnCount: z.number().int().positive().optional(),
    gridRowGap: z.number().optional(),
    gridColumnGap: z.number().optional(),
  },
  kind: 'write',
};
