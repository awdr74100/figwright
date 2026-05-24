import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const BATCH_TOOL_NAME = 'batch';

/**
 * Apply several invertible write ops atomically. The plugin validates every op's target first, then
 * applies them in order; if any op fails it rolls the already-applied ops back and the call rejects.
 * Only invertible writes are accepted (property mutations + create/clone/import_image) — destructive
 * ops (delete_*, ungroup, …) can't be restored and are rejected, so the all-or-nothing guarantee holds.
 */
export const batchToolDefinition: Tool = {
  name: BATCH_TOOL_NAME,
  description:
    'Apply multiple invertible write ops atomically (all-or-nothing with rollback). ops is an ordered ' +
    'list of { tool, params } where tool is an invertible write (e.g. set_fills, rename_node, ' +
    'move_nodes, create_frame). Destructive ops (delete_*, ungroup_nodes, …) are rejected. ' +
    'Returns { ok, results } with one result per op in order.',
  inputSchema: {
    type: 'object',
    properties: {
      ops: {
        type: 'array',
        minItems: 1,
        description: 'Ordered write ops applied atomically',
        items: {
          type: 'object',
          properties: {
            tool: { type: 'string', description: 'An invertible write tool name' },
            params: { type: 'object', description: "The tool's parameters" },
          },
          required: ['tool'],
          additionalProperties: false,
        },
      },
    },
    required: ['ops'],
    additionalProperties: false,
  },
};
