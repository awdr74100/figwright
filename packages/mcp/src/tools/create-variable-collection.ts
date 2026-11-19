import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const CREATE_VARIABLE_COLLECTION_TOOL_NAME = 'create_variable_collection';

export const createVariableCollectionTool: ToolSpec = {
  name: CREATE_VARIABLE_COLLECTION_TOOL_NAME,
  description:
    'Create a variable collection. Figma auto-creates a default mode. A collection made here starts ' +
    'HIDDEN from publishing — unlike one made in the Figma UI — so its variables are left out of ' +
    'the library when the file is published; pass hiddenFromPublishing: false for a collection ' +
    'meant to be shared. Returns { ok, collectionId, defaultModeId, name, hiddenFromPublishing }.',
  inputSchema: z.object({
    name: z.string().describe('Collection name, e.g. "Theme"'),
    hiddenFromPublishing: z
      .boolean()
      .optional()
      .describe(
        "false publishes the collection with the library; omit for Figma's default (hidden)",
      ),
  }),
  kind: 'write',
};
