import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const LOCK_NODES_TOOL_NAME = 'lock_nodes';

export const lockNodesTool: ToolSpec = {
  name: LOCK_NODES_TOOL_NAME,
  description: 'Lock nodes (prevent selection/editing on canvas). Returns { ok, affected }.',
  inputShape: {
    nodeIds: z.array(z.string()).describe('Node ids to lock'),
  },
  kind: 'write',
};
