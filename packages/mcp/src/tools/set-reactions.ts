import { SerializedReactionSchema } from '@figwright/shared';
import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_REACTIONS_TOOL_NAME = 'set_reactions';

export const setReactionsTool: ToolSpec = {
  name: SET_REACTIONS_TOOL_NAME,
  description:
    "Replace all of a node's prototype reactions — this overwrites existing reactions rather than " +
    "appending. Each reaction pairs a trigger (e.g. { type: 'ON_CLICK' }, or ON_KEY_DOWN with " +
    'device + keyCodes) with an actions array: NODE carries destinationId, navigation ' +
    '(NAVIGATE / SWAP / OVERLAY / SCROLL_TO / CHANGE_TO) and transition; URL, BACK, CLOSE, ' +
    'SET_VARIABLE, SET_VARIABLE_MODE, UPDATE_MEDIA_RUNTIME and CONDITIONAL carry their own fields. ' +
    'An OVERLAY action takes overlayRelativePosition ({ x, y }) to offset the overlay, which Figma ' +
    "applies only when the destination frame's overlay position is set to Manual — that setting " +
    'lives on the frame and is read-only to plugins, so it must be chosen in Figma first. ' +
    'get_reactions output round-trips through here unchanged; to clear all reactions instead use ' +
    'remove_reactions. Returns { ok, nodeId }.',
  inputSchema: z.object({
    nodeId: z.string().describe('Node to set reactions on'),
    // Derived from the wire format rather than restated: get_reactions emits exactly this shape and
    // this tool is how it goes back, so a second hand-kept mirror here could only drift out of
    // agreement with the sandbox — and a stale mirror used for validation rejects good calls.
    reactions: z.array(SerializedReactionSchema).describe('Reactions to apply (replaces existing)'),
  }),
  kind: 'write',
};
