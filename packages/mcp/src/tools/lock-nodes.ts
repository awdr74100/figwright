import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const LOCK_NODES_TOOL_NAME = 'lock_nodes';

export const lockNodesTool: ToolSpec = {
  name: LOCK_NODES_TOOL_NAME,
  description:
    "Lock nodes so they can't be selected or edited on the canvas (e.g. backgrounds); locking a " +
    'parent also locks its descendants. Locked nodes still render and export — this only affects ' +
    'canvas interaction and is reversed by unlock_nodes. Returns { ok, affected } with the ids ' +
    'actually locked.',
  inputShape: {
    nodeIds: z.array(z.string()).describe('Node ids to lock'),
  },
  kind: 'write',
};
