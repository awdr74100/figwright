import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_OPACITY_TOOL_NAME = 'set_opacity';

export const setOpacityTool: ToolSpec = {
  name: SET_OPACITY_TOOL_NAME,
  description:
    "Set a node's layer opacity from 0 (transparent) to 1 (opaque); this multiplies with any fill " +
    'or stroke alpha. Opacity 0 still renders, exports, and hit-tests — to exclude a node from ' +
    'rendering use set_visible(false), and to remove it use delete_nodes. Returns { ok, nodeId }.',
  inputShape: {
    nodeId: z.string().describe('Figma node id'),
    opacity: z.number().min(0).max(1).describe('Opacity 0–1'),
  },
  kind: 'write',
};
