import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const BATCH_TOOL_NAME = 'batch';

/**
 * Apply several write ops atomically. The plugin snapshots every op's target first, then applies
 * them in order; if any op fails it rolls the already-applied ops back — values, style links,
 * variable bindings, text runs, layout and instance overrides — and the call rejects. An op joins
 * only if it has a faithful inverse: ops that delete something cannot bring its id back and are
 * refused with the reason, so the all-or-nothing guarantee holds.
 */
export const batchTool: ToolSpec = {
  name: BATCH_TOOL_NAME,
  description:
    'Apply multiple write ops atomically (all-or-nothing with rollback). ops is an ordered list of ' +
    '{ tool, params } where tool is any write that can be undone exactly — property, text, layout, ' +
    'style, variable, component, structure and create writes (e.g. set_fills, set_text, ' +
    'set_auto_layout, reparent_nodes, create_frame). Ops that delete something (delete_*, ' +
    'ungroup_nodes, detach_instance, remove_animation_style) are refused, since what they delete ' +
    'cannot come back under its id. An op can use what an earlier op in the same batch created: ' +
    'in an id argument, "$N" is op N\'s id (0-based) — so a whole tree (frame → row → text, a ' +
    'collection → variable → binding) goes in one batch and one undo step. "$N" reads the id the ' +
    'argument asks for (nodeId for parentId / nodeIds, variableId for variableId or an alias id, ' +
    'modeId else defaultModeId for modeId, …); "$N.key" names a result key instead (e.g. ' +
    '"$0.defaultModeId"). It works in id arguments only, at any depth (boundVariables values, ' +
    'reaction destinationId, set_instance_properties keys, an INSTANCE_SWAP value or defaultValue), ' +
    'never in text. ' +
    'Returns { ok, results } with one result per op in order; on failure the error says what was ' +
    'rolled back.',
  inputSchema: z.object({
    ops: z
      .array(
        z.object({
          tool: z.string().describe('The name of the write tool to run'),
          // Free-form: each tool validates its own params (and, post-McpServer, the inner tool's spec).
          params: z
            .record(z.string(), z.unknown())
            .optional()
            .describe('The tool\'s parameters; an id may be "$N" — the id op N created'),
        }),
      )
      .min(1)
      .describe('Ordered write ops applied atomically'),
  }),
  kind: 'write',
};
