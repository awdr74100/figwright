import { z } from 'zod';

import { specToToolDefinition, type ToolSpec } from './spec.js';

export const BATCH_TOOL_NAME = 'batch';

/**
 * Apply several invertible write ops atomically. The plugin validates every op's target first, then
 * applies them in order; if any op fails it rolls the already-applied ops back and the call
 * rejects. Only invertible writes are accepted (property mutations + create/clone/import_image) —
 * destructive ops (delete_*, ungroup, …) can't be restored and are rejected, so the all-or-nothing
 * guarantee holds.
 */
export const batchTool: ToolSpec = {
  name: BATCH_TOOL_NAME,
  description:
    'Apply multiple invertible write ops atomically (all-or-nothing with rollback). ops is an ordered ' +
    'list of { tool, params } where tool is an invertible write (e.g. set_fills, rename_node, ' +
    'move_nodes, create_frame). Destructive ops (delete_*, ungroup_nodes, …) are rejected. ' +
    'Returns { ok, results } with one result per op in order.',
  inputShape: {
    ops: z
      .array(
        z.object({
          tool: z.string().describe('An invertible write tool name'),
          // Free-form: each tool validates its own params (and, post-McpServer, the inner tool's spec).
          params: z.record(z.string(), z.unknown()).optional().describe("The tool's parameters"),
        }),
      )
      .min(1)
      .describe('Ordered write ops applied atomically'),
  },
  kind: 'write',
};

export const batchToolDefinition = specToToolDefinition(batchTool);
