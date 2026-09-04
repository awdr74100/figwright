import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const GET_REACTIONS_TOOL_NAME = 'get_reactions';

export const getReactionsTool: ToolSpec = {
  name: GET_REACTIONS_TOOL_NAME,
  description:
    'Return the prototype reactions on a node as { nodeId, reactions: [{ trigger, actions }] }. ' +
    'Each reaction pairs an interaction trigger (click, hover, key press, timeout…) with its ' +
    'actions — navigate to a node, open an overlay, open a URL, back/close, set a variable or ' +
    'variable mode, control media, or a conditional block. Every field Figma holds is returned, ' +
    "including each action's transition and easing, so the output can be handed back to " +
    'set_reactions unchanged to reproduce the reactions exactly.',
  inputSchema: z.object({ nodeId: z.string().describe('Figma node id to read reactions from') }),
  kind: 'read',
};
