import { z } from 'zod';

import { specToToolDefinition, type ToolSpec } from './spec.js';

export const DELETE_NODES_TOOL_NAME = 'delete_nodes';

export const deleteNodesTool: ToolSpec = {
  name: DELETE_NODES_TOOL_NAME,
  description:
    'Delete nodes by id. Missing / non-removable nodes are skipped. Returns { ok, affected } — the ids actually removed.',
  inputShape: {
    nodeIds: z.array(z.string()).describe('Node ids to delete'),
  },
  kind: 'write',
};

export const deleteNodesToolDefinition = specToToolDefinition(deleteNodesTool);
