import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_TEXT_TOOL_NAME = 'set_text';

export const setTextTool: ToolSpec = {
  name: SET_TEXT_TOOL_NAME,
  description:
    "Replace a TEXT node's characters. The plugin loads the node's fonts first. Returns { ok, nodeId }.",
  inputShape: {
    nodeId: z.string().describe('TEXT node id to update'),
    characters: z.string().describe('New text content'),
  },
  kind: 'write',
};
