import { z } from 'zod';

import { REPEAT_SEMANTICS, repeatModifierSchema } from './repeat-schema.js';
import type { ToolSpec } from './spec.js';

export const REPEAT_NODES_TOOL_NAME = 'repeat_nodes';

export const repeatNodesTool: ToolSpec = {
  name: REPEAT_NODES_TOOL_NAME,
  description:
    'Wrap layers in a repeat group (Figma Draw), which draws their content several times and ' +
    'stays live — edit the content and every copy follows: a row or grid of dots, the ticks round ' +
    'a dial, petals round a centre, a dashed border made of shapes. ' +
    REPEAT_SEMANTICS +
    ' The nodes must share a parent; the group takes the place of the topmost and the content keeps ' +
    'its position. Change the repeat later with set_repeat; ungroup_nodes removes it. Returns ' +
    '{ ok, nodeId, name, type } for the new TRANSFORM_GROUP.',
  inputSchema: z.object({
    nodeIds: z.array(z.string()).min(1).describe('Layers to repeat (one parent)'),
    modifiers: z
      .array(repeatModifierSchema)
      .min(1)
      .max(2)
      .describe('1 or 2 modifiers; the second repeats everything the first drew'),
    name: z.string().optional().describe('Name for the repeat group'),
  }),
  kind: 'write',
};
