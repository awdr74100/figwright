import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const GET_NODE_TOOL_NAME = 'get_node';

export const getNodeTool: ToolSpec = {
  name: GET_NODE_TOOL_NAME,
  description: 'Return a single Figma node by id, with full recursive children subtree.',
  inputShape: { nodeId: z.string().describe('Figma node id, e.g. "1:42"') },
  kind: 'read',
};
