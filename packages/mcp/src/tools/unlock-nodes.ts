import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const UNLOCK_NODES_TOOL_NAME = 'unlock_nodes';

export const unlockNodesTool: ToolSpec = {
  name: UNLOCK_NODES_TOOL_NAME,
  description:
    'Unlock nodes so they can be selected and edited on the canvas again — the inverse of ' +
    'lock_nodes. Ids that no longer exist are skipped. Returns { ok, affected } with the ids ' +
    'actually unlocked.',
  inputShape: {
    nodeIds: z.array(z.string()).describe('Node ids to unlock'),
  },
  kind: 'write',
};
