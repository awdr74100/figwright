import { z } from 'zod';

import { specToToolDefinition, type ToolSpec } from './spec.js';

export const RENAME_NODE_TOOL_NAME = 'rename_node';

export const renameNodeTool: ToolSpec = {
  name: RENAME_NODE_TOOL_NAME,
  description: 'Rename a node. Returns { ok, nodeId }.',
  inputShape: {
    nodeId: z.string().describe('Figma node id'),
    name: z.string().describe('New layer name'),
  },
  kind: 'write',
};

export const renameNodeToolDefinition = specToToolDefinition(renameNodeTool);
