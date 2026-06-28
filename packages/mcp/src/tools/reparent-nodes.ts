import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const REPARENT_NODES_TOOL_NAME = 'reparent_nodes';

export const reparentNodesTool: ToolSpec = {
  name: REPARENT_NODES_TOOL_NAME,
  description:
    'Move nodes into a different parent, optionally inserting at `index` (default: appended last). ' +
    'On-screen positions may shift because coordinates become relative to the new parent; nodes ' +
    'that no longer exist are skipped. To reorder within the current parent use reorder_nodes; to ' +
    'wrap nodes in a new frame/group use group_nodes. Returns { ok, affected }.',
  inputShape: {
    nodeIds: z.array(z.string()).describe('Node ids to move'),
    newParentId: z.string().describe('Id of the parent to move them into'),
    index: z.number().optional().describe('Optional insertion index within the new parent'),
  },
  kind: 'write',
};
