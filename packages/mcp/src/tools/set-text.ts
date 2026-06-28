import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_TEXT_TOOL_NAME = 'set_text';

export const setTextTool: ToolSpec = {
  name: SET_TEXT_TOOL_NAME,
  description:
    "Replace the entire text content of a TEXT node; the plugin loads the node's current fonts " +
    'first and preserves existing character styling where possible. For formatting (font, size, ' +
    'color, spacing) use set_text_properties, and to substitute text across many nodes use ' +
    'find_replace_text. Returns { ok, nodeId }.',
  inputShape: {
    nodeId: z.string().describe('TEXT node id to update'),
    characters: z.string().describe('New text content'),
  },
  kind: 'write',
};
