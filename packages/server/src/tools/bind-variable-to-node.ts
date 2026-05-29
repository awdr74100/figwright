import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const BIND_VARIABLE_TO_NODE_TOOL_NAME = 'bind_variable_to_node';

export const bindVariableToNodeTool: ToolSpec = {
  name: BIND_VARIABLE_TO_NODE_TOOL_NAME,
  description:
    'Bind a variable to a node field (e.g. width, height, characters, itemSpacing, ' +
    'topLeftRadius). The variable type must match the field. Returns { ok, nodeId }.',
  inputShape: {
    nodeId: z.string().describe('Node to bind on'),
    field: z.string().describe('Bindable field name, e.g. "width"'),
    variableId: z.string().describe('Variable id to bind'),
  },
  kind: 'write',
};
