import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const BIND_VARIABLE_TO_PAINT_TOOL_NAME = 'bind_variable_to_paint';

export const bindVariableToPaintTool: ToolSpec = {
  name: BIND_VARIABLE_TO_PAINT_TOOL_NAME,
  description:
    'Bind a COLOR variable to a SOLID fill or stroke paint (the design-token way to colour a node) ' +
    '— or unbind by passing variableId: null. Figma stores fill/stroke colour bindings on the paint, ' +
    'not the node, so this is separate from bind_variable_to_node (which covers scalar fields like ' +
    'width / padding / radius). target is fills (default) or strokes; index selects which paint ' +
    '(default 0). The paint at that index must be SOLID. Returns { ok, nodeId }.',
  inputShape: {
    nodeId: z.string().describe('Node whose fill/stroke paint to bind'),
    target: z
      .enum(['fills', 'strokes'])
      .optional()
      .describe('Which paint list to bind on (default fills)'),
    index: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Index of the paint within the list (default 0)'),
    variableId: z
      .string()
      .nullable()
      .describe('COLOR variable id to bind, or null to remove the binding'),
  },
  kind: 'write',
};
