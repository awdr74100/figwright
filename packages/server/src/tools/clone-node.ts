import { z } from 'zod';

import { specToToolDefinition, type ToolSpec } from './spec.js';

export const CLONE_NODE_TOOL_NAME = 'clone_node';

export const cloneNodeTool: ToolSpec = {
  name: CLONE_NODE_TOOL_NAME,
  description:
    'Duplicate a node next to the original (same parent). Returns { ok, nodeId, name, type } for the copy.',
  inputShape: {
    nodeId: z.string().describe('Node id to clone'),
  },
  kind: 'write',
};

export const cloneNodeToolDefinition = specToToolDefinition(cloneNodeTool);
