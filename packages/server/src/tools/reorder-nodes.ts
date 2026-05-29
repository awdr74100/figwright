import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const REORDER_NODES_TOOL_NAME = 'reorder_nodes';

export const reorderNodesTool: ToolSpec = {
  name: REORDER_NODES_TOOL_NAME,
  description:
    'Reorder nodes within their current parent by inserting each at `index` (0 = bottom of the ' +
    'z-order). Detached nodes are skipped. Returns { ok, affected }.',
  inputShape: {
    nodeIds: z.array(z.string()).describe('Node ids to reorder'),
    index: z.number().describe('Target index within the parent'),
  },
  kind: 'write',
};
