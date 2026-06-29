import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_POSITION_TOOL_NAME = 'set_position';

export const setPositionTool: ToolSpec = {
  name: SET_POSITION_TOOL_NAME,
  description:
    "Set a node's exact position (x / y), relative to its parent — for a top-level node these are " +
    'canvas coordinates; for an absolutely-positioned child they are relative to its auto-layout ' +
    'parent. Use this to place an overlay / badge / pinned element at a known spot, or to position ' +
    'a top-level frame on the canvas; to nudge by a delta instead use move_nodes. A node that sits ' +
    'in-flow inside an auto-layout frame is positioned by the layout — set layoutPositioning ' +
    'ABSOLUTE (set_layout_props) first to place it freely. Either coordinate may be omitted to ' +
    'leave it unchanged. Returns { ok, nodeId }.',
  inputShape: {
    nodeId: z.string().describe('Node id to position'),
    x: z.number().optional().describe('X position relative to the parent'),
    y: z.number().optional().describe('Y position relative to the parent'),
  },
  kind: 'write',
};
