import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const RENAME_NODE_TOOL_NAME = 'rename_node';

export const renameNodeTool: ToolSpec = {
  name: RENAME_NODE_TOOL_NAME,
  description:
    "Rename a single canvas node's layer name; does not affect a component's name elsewhere or its " +
    'instances. To rename a document page use rename_page; to rename many nodes by pattern use ' +
    'batch_rename_nodes. Returns { ok, nodeId }.',
  inputShape: {
    nodeId: z.string().describe('Figma node id'),
    name: z.string().describe('New layer name'),
  },
  kind: 'write',
};
