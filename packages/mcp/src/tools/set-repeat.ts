import { z } from 'zod';

import { REPEAT_SEMANTICS, repeatModifierSchema } from './repeat-schema.js';
import type { ToolSpec } from './spec.js';

export const SET_REPEAT_TOOL_NAME = 'set_repeat';

export const setRepeatTool: ToolSpec = {
  name: SET_REPEAT_TOOL_NAME,
  description:
    'Replace how a repeat group (TRANSFORM_GROUP — from repeat_nodes, or drawn in Figma Draw) ' +
    'repeats its content. ' +
    REPEAT_SEMANTICS +
    ' get_node reads the current modifiers in this same shape. [] keeps the group and draws the ' +
    'content once. A repeat group inside an instance cannot take this — Figma does not let an ' +
    'instance override it; change the main component. Returns { ok, nodeId }.',
  inputSchema: z.object({
    nodeId: z.string().describe('The repeat group (TRANSFORM_GROUP)'),
    modifiers: z
      .array(repeatModifierSchema)
      .max(2)
      .describe('0–2 modifiers; the second repeats everything the first drew'),
  }),
  kind: 'write',
};
