import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const GET_REACTIONS_TOOL_NAME = 'get_reactions';

export const getReactionsTool: ToolSpec = {
  name: GET_REACTIONS_TOOL_NAME,
  description:
    'Return the prototype reactions on a node as { nodeId, reactions: [{ trigger, actions }] }. ' +
    'Each reaction pairs an interaction trigger (click, hover, timeout…) with its actions ' +
    '(navigate to node, open URL, back/close…).',
  inputShape: { nodeId: z.string().describe('Figma node id to read reactions from') },
  kind: 'read',
};
