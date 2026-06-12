import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const BATCH_RENAME_NODES_TOOL_NAME = 'batch_rename_nodes';

export const batchRenameNodesTool: ToolSpec = {
  name: BATCH_RENAME_NODES_TOOL_NAME,
  description:
    'Rename many nodes at once from a [{ nodeId, name }] list. Missing nodes are skipped. ' +
    'Returns { ok, affected }.',
  inputShape: {
    renames: z
      .array(z.object({ nodeId: z.string(), name: z.string() }))
      .describe('Per-node rename instructions'),
  },
  kind: 'write',
};
