import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_VISIBLE_TOOL_NAME = 'set_visible';

export const setVisibleTool: ToolSpec = {
  name: SET_VISIBLE_TOOL_NAME,
  description:
    'Show or hide a node by toggling its `visible` flag. A hidden node stays in the layer tree but ' +
    'is excluded from rendering and exports, and its descendants are hidden with it; the change is ' +
    'fully reversible. To remove a node use delete_nodes; to dim one while keeping it visible and ' +
    'exported use set_opacity. Returns { ok, nodeId }.',
  inputShape: {
    nodeId: z.string().describe('Figma node id'),
    visible: z.boolean().describe('true to show, false to hide'),
  },
  kind: 'write',
};
