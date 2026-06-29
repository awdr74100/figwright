import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_LAYOUT_PROPS_TOOL_NAME = 'set_layout_props';

export const setLayoutPropsTool: ToolSpec = {
  name: SET_LAYOUT_PROPS_TOOL_NAME,
  description:
    "Set a node's auto-layout sizing and child properties. layoutSizingHorizontal / " +
    'layoutSizingVertical (HUG = shrink to fit children, FILL = stretch to fill the auto-layout ' +
    'parent, FIXED = keep the current size) are the preferred way to size a frame to its content ' +
    '(HUG) or make a child fill its container (FILL) — reach for these instead of guessing pixel ' +
    'sizes with resize_nodes. layoutAlign (STRETCH = fill the counter axis, INHERIT = default) and ' +
    'layoutGrow (1 = fill the primary axis, 0 = hug) are the older per-axis equivalents. ' +
    'layoutPositioning (ABSOLUTE = ignore the flow and position freely, AUTO = participate in ' +
    'layout). HUG needs an auto-layout frame (or text); FILL needs an auto-layout parent. Any field ' +
    'may be omitted to leave it unchanged. Returns { ok, nodeId }.',
  inputShape: {
    nodeId: z.string().describe('Node id — an auto-layout frame, or a child inside one'),
    layoutSizingHorizontal: z
      .enum(['FIXED', 'HUG', 'FILL'])
      .optional()
      .describe('Horizontal sizing: HUG fits content, FILL fills the parent, FIXED keeps width'),
    layoutSizingVertical: z
      .enum(['FIXED', 'HUG', 'FILL'])
      .optional()
      .describe('Vertical sizing: HUG fits content, FILL fills the parent, FIXED keeps height'),
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
