import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_LAYOUT_PROPS_TOOL_NAME = 'set_layout_props';

export const setLayoutPropsTool: ToolSpec = {
  name: SET_LAYOUT_PROPS_TOOL_NAME,
  description:
    "Set a node's auto-layout child properties — how it behaves inside its auto-layout parent. " +
    'layoutAlign (STRETCH = fill the counter axis, INHERIT = default). layoutGrow (1 = grow to ' +
    'fill the primary axis / "fill container", 0 = hug). layoutPositioning (ABSOLUTE = ignore the ' +
    'flow and position freely, AUTO = participate in layout). Any field may be omitted to leave it ' +
    'unchanged. Returns { ok, nodeId }.',
  inputShape: {
    nodeId: z.string().describe('Child node id (must sit inside an auto-layout frame)'),
    layoutAlign: z
      .enum(['MIN', 'CENTER', 'MAX', 'STRETCH', 'INHERIT'])
      .optional()
      .describe('Counter-axis alignment; STRETCH fills the counter axis'),
    layoutGrow: z
      .number()
      .min(0)
      .optional()
      .describe('1 = grow to fill the primary axis, 0 = hug content'),
    layoutPositioning: z
      .enum(['AUTO', 'ABSOLUTE'])
      .optional()
      .describe('ABSOLUTE takes the node out of the auto-layout flow'),
  },
  kind: 'write',
};
