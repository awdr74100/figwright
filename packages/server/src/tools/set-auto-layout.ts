import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_AUTO_LAYOUT_TOOL_NAME = 'set_auto_layout';

export const setAutoLayoutTool: ToolSpec = {
  name: SET_AUTO_LAYOUT_TOOL_NAME,
  description:
    "Configure a frame's auto layout. layoutMode NONE disables it; HORIZONTAL/VERTICAL enable it " +
    'with optional padding / itemSpacing / alignment / wrap. Returns { ok, nodeId }.',
  inputShape: {
    nodeId: z.string(),
    layoutMode: z.enum(['NONE', 'HORIZONTAL', 'VERTICAL']),
    paddingTop: z.number().optional(),
    paddingRight: z.number().optional(),
    paddingBottom: z.number().optional(),
    paddingLeft: z.number().optional(),
    itemSpacing: z.number().optional(),
    primaryAxisAlignItems: z.enum(['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN']).optional(),
    counterAxisAlignItems: z.enum(['MIN', 'CENTER', 'MAX', 'BASELINE']).optional(),
    layoutWrap: z.enum(['NO_WRAP', 'WRAP']).optional(),
  },
  kind: 'write',
};
