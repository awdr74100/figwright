import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_NODE_VARIABLE_MODE_TOOL_NAME = 'set_node_variable_mode';

export const setNodeVariableModeTool: ToolSpec = {
  name: SET_NODE_VARIABLE_MODE_TOOL_NAME,
  description:
    "Switch a node to one of a variable collection's modes — the Dark (or another theme, brand or " +
    'language) variant of a frame, a component, a layer inside an instance, or a whole page — so ' +
    "every variable bound in its subtree takes that mode's value. This changes which mode a node " +
    'renders in; to add or ' +
    'remove modes on the collection itself use add_variable_mode / delete_variable_mode. collectionId ' +
    'and modeId come from get_variable_defs. modeId null clears the setting so the node inherits its ' +
    "parent's mode again. Returns { ok, nodeId, collectionId, collectionName, modeId, modeName }.",
  inputSchema: z.object({
    nodeId: z.string().describe('Node to switch: any layer, or a page'),
    collectionId: z.string().describe('Variable collection id, from get_variable_defs'),
    modeId: z
      .string()
      .nullable()
      .describe("A mode id of that collection; null clears it so the node inherits its parent's"),
  }),
  kind: 'write',
};
