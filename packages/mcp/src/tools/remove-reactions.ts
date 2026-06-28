import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const REMOVE_REACTIONS_TOOL_NAME = 'remove_reactions';

export const removeReactionsTool: ToolSpec = {
  name: REMOVE_REACTIONS_TOOL_NAME,
  description:
    'Clear every prototype reaction from a node (equivalent to set_reactions with an empty array). ' +
    'Use this to strip interactivity; to replace reactions with new ones use set_reactions. Returns ' +
    '{ ok, nodeId }.',
  inputShape: {
    nodeId: z.string().describe('Node to clear reactions from'),
  },
  kind: 'write',
};
