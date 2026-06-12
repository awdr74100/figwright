import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_BLEND_MODE_TOOL_NAME = 'set_blend_mode';

export const setBlendModeTool: ToolSpec = {
  name: SET_BLEND_MODE_TOOL_NAME,
  description:
    "Set a node's blend mode (e.g. NORMAL, MULTIPLY, SCREEN, OVERLAY). Returns { ok, nodeId }.",
  inputShape: {
    nodeId: z.string(),
    blendMode: z.string().describe('Figma blend mode literal'),
  },
  kind: 'write',
};
