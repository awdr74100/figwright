import { z } from 'zod';

import { specToToolDefinition, type ToolSpec } from './spec.js';

export const REPARENT_NODES_TOOL_NAME = 'reparent_nodes';

export const reparentNodesTool: ToolSpec = {
  name: REPARENT_NODES_TOOL_NAME,
  description:
    'Move nodes into a new parent (optionally at `index`). Nodes that no longer exist are skipped. ' +
    'Returns { ok, affected }.',
  inputShape: {
    nodeIds: z.array(z.string()).describe('Node ids to move'),
    newParentId: z.string().describe('Id of the parent to move them into'),
    index: z.number().optional().describe('Optional insertion index within the new parent'),
  },
  kind: 'write',
};

export const reparentNodesToolDefinition = specToToolDefinition(reparentNodesTool);
