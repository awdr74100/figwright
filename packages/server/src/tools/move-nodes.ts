import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const MOVE_NODES_TOOL_NAME = 'move_nodes';

export const moveNodesTool: ToolSpec = {
  name: MOVE_NODES_TOOL_NAME,
  description:
    'Translate nodes by (dx, dy). Nodes without a position are skipped. Returns { ok, affected }.',
  inputShape: {
    nodeIds: z.array(z.string()).describe('Node ids to move'),
    dx: z.number().optional().describe('Horizontal delta (default 0)'),
    dy: z.number().optional().describe('Vertical delta (default 0)'),
  },
  kind: 'write',
};
