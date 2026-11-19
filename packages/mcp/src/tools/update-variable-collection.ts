import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const UPDATE_VARIABLE_COLLECTION_TOOL_NAME = 'update_variable_collection';

export const updateVariableCollectionTool: ToolSpec = {
  name: UPDATE_VARIABLE_COLLECTION_TOOL_NAME,
  description:
    'Rename a variable collection and/or its modes, or change whether it is published with the ' +
    'library. Any of name / modes / hiddenFromPublishing may be omitted to leave it unchanged. No id changes, so every binding and every mode value survives — this is how a ' +
    'mis-named collection gets fixed, because deleting and recreating one mints a new id and takes ' +
    'its variables and modes with it. Mode ids come from get_variable_defs. Every mode id is ' +
    'checked before anything is written, so one bad id leaves the collection untouched rather than ' +
    'half-renamed. Returns { ok, collectionId, name, modes, hiddenFromPublishing? } with the full ' +
    'mode list as it now stands (hiddenFromPublishing when the call set it).',
  inputSchema: z.object({
    collectionId: z.string().describe('Variable collection id'),
    name: z.string().optional().describe('New collection name, e.g. "Color"'),
    modes: z
      .array(
        z.object({
          modeId: z.string().describe('Mode id, from get_variable_defs'),
          name: z.string().describe('New mode name, e.g. "Dark"'),
        }),
      )
      .optional()
      .describe('Modes to rename; modes left out of the array keep their current names'),
    hiddenFromPublishing: z
      .boolean()
      .optional()
      .describe('true leaves the collection out of the published library, false publishes it'),
  }),
  kind: 'write',
};
