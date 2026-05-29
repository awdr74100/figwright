import { z } from 'zod';

import { specToToolDefinition, type ToolSpec } from './spec.js';

export const SET_REACTIONS_TOOL_NAME = 'set_reactions';

// Loose throughout because this is meant to round-trip get_reactions output, whose triggers/actions
// carry more fields than any single write needs; the plugin reads the shape it understands.
const trigger = z
  .looseObject({
    type: z.string().optional(),
    timeout: z.number().optional(),
    delay: z.number().optional(),
  })
  .nullable();

const action = z.looseObject({
  type: z.string(),
  destinationId: z.string().nullable().optional(),
  navigation: z.string().optional(),
  url: z.string().optional(),
});

const reaction = z.looseObject({ trigger, actions: z.array(action) });

export const setReactionsTool: ToolSpec = {
  name: SET_REACTIONS_TOOL_NAME,
  description:
    "Replace a node's prototype reactions. Each reaction has a trigger (e.g. { type: 'ON_CLICK' }) " +
    "and an actions array (e.g. { type: 'NODE', destinationId, navigation, transition }). Best used " +
    'to round-trip get_reactions output. Returns { ok, nodeId }.',
  inputShape: {
    nodeId: z.string().describe('Node to set reactions on'),
    reactions: z.array(reaction).describe('Reactions to apply (replaces existing)'),
  },
  kind: 'write',
};

export const setReactionsToolDefinition = specToToolDefinition(setReactionsTool);
