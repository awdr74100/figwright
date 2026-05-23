import * as v from 'valibot';

// Write tools carry a server-generated requestId so the plugin can dedupe retries (idempotency).
// Inputs are validated per-tool in the plugin handlers; this module holds the shared result shapes.

/** Result of a property-mutation write (set_fills / set_text / …). */
export const MutateResultSchema = v.object({
  ok: v.literal(true),
  nodeId: v.string(),
});
export type MutateResult = v.InferOutput<typeof MutateResultSchema>;

/** Result of a node-creation write (create_frame / …): the new node's id + identity. */
export const CreateResultSchema = v.object({
  ok: v.literal(true),
  nodeId: v.string(),
  name: v.string(),
  type: v.string(),
});
export type CreateResult = v.InferOutput<typeof CreateResultSchema>;

/** Result of a multi-node op (delete_nodes / …): which target ids were actually affected. */
export const BatchNodeResultSchema = v.object({
  ok: v.literal(true),
  affected: v.array(v.string()),
});
export type BatchNodeResult = v.InferOutput<typeof BatchNodeResultSchema>;
