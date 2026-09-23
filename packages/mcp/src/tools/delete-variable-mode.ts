import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const DELETE_VARIABLE_MODE_TOOL_NAME = 'delete_variable_mode';

export const deleteVariableModeTool: ToolSpec = {
  name: DELETE_VARIABLE_MODE_TOOL_NAME,
  description:
    'Remove a mode from a variable collection, freeing the slot it holds — mode count is gated by ' +
    "the file's Figma plan (Starter allows 1 per collection), so a mode added by mistake otherwise " +
    "occupies that budget for good. Every variable's value for this mode goes with it. Not " +
    'reversible: adding a mode back mints a new mode id, and the values that hung on the old id do ' +
    'not come with it — which is also why this tool cannot be used inside batch. Removing the ' +
    "collection's default mode is allowed (Figma moves the default to a mode that remains); the " +
    'last remaining mode cannot be removed. Mode ids come from get_variable_defs. Returns ' +
    '{ ok, collectionId, modeId, name }.',
  inputSchema: z.object({
    collectionId: z.string().describe('Variable collection id'),
    modeId: z.string().describe('Mode id to remove, from get_variable_defs'),
  }),
  kind: 'write',
  destructive: true,
};
