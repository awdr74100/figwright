import { z } from 'zod';

import { specToToolDefinition, type ToolSpec } from './spec.js';

export const UNLOCK_NODES_TOOL_NAME = 'unlock_nodes';

export const unlockNodesTool: ToolSpec = {
  name: UNLOCK_NODES_TOOL_NAME,
  description: 'Unlock nodes. Returns { ok, affected }.',
  inputShape: {
    nodeIds: z.array(z.string()).describe('Node ids to unlock'),
  },
  kind: 'write',
};

export const unlockNodesToolDefinition = specToToolDefinition(unlockNodesTool);
