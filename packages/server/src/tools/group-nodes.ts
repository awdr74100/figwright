import { z } from 'zod';

import { specToToolDefinition, type ToolSpec } from './spec.js';

export const GROUP_NODES_TOOL_NAME = 'group_nodes';

export const groupNodesTool: ToolSpec = {
  name: GROUP_NODES_TOOL_NAME,
  description:
    'Group nodes under their shared parent. nodeIds must be a non-empty list. ' +
    'Returns { ok, nodeId, name, type } for the new group.',
  inputShape: {
    nodeIds: z.array(z.string()).describe('Node ids to group'),
    name: z.string().optional().describe('Optional name for the new group'),
  },
  kind: 'write',
};

export const groupNodesToolDefinition = specToToolDefinition(groupNodesTool);
