import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const CLONE_NODE_TOOL_NAME = 'clone_node';

export const cloneNodeTool: ToolSpec = {
  name: CLONE_NODE_TOOL_NAME,
  description:
    'Duplicate a node — including its full subtree — and place the copy as a sibling right after ' +
    'the original under the same parent. Cloning a component instance keeps it an instance; to make ' +
    "a fresh instance of a component use create_instance instead. Cloning a prototype flow's " +
    'starting frame also clones the flow, under the same name, right after the original (rename ' +
    'or remove it with update_flows). Returns { ok, nodeId, name, type } for the copy.',
  inputSchema: z.object({
    nodeId: z.string().describe('Node id to clone'),
  }),
  kind: 'write',
};
