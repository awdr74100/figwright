import { z } from 'zod';

import { specToToolDefinition, type ToolSpec } from './spec.js';

export const REMOVE_REACTIONS_TOOL_NAME = 'remove_reactions';

export const removeReactionsTool: ToolSpec = {
  name: REMOVE_REACTIONS_TOOL_NAME,
  description: 'Clear all prototype reactions from a node. Returns { ok, nodeId }.',
  inputShape: {
    nodeId: z.string().describe('Node to clear reactions from'),
  },
  kind: 'write',
};

export const removeReactionsToolDefinition = specToToolDefinition(removeReactionsTool);
