import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const UNGROUP_NODES_TOOL_NAME = 'ungroup_nodes';

export const ungroupNodesTool: ToolSpec = {
  name: UNGROUP_NODES_TOOL_NAME,
  description:
    'Ungroup GROUP nodes by id; non-group nodes are skipped. ' +
    'Returns { ok, affected } — the ids of the children promoted out of the groups.',
  inputShape: {
    nodeIds: z.array(z.string()).describe('Group node ids to ungroup'),
  },
  kind: 'write',
};
