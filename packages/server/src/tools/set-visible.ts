import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_VISIBLE_TOOL_NAME = 'set_visible';

export const setVisibleTool: ToolSpec = {
  name: SET_VISIBLE_TOOL_NAME,
  description: 'Show or hide a node. Returns { ok, nodeId }.',
  inputShape: {
    nodeId: z.string().describe('Figma node id'),
    visible: z.boolean().describe('true to show, false to hide'),
  },
  kind: 'write',
};
