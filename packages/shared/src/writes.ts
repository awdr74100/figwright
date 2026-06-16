import { z } from 'zod';

// Write tools carry a server-generated requestId so the plugin can dedupe retries (idempotency).
// Inputs are validated per-tool in the plugin handlers; this module holds the shared result shapes.

/** Result of a property-mutation write (set_fills / set_text / …). */
export const MutateResultSchema = z.object({
  ok: z.literal(true),
  nodeId: z.string(),
});
export type MutateResult = z.infer<typeof MutateResultSchema>;

/** Result of a node-creation write (create_frame / …): the new node's id + identity. */
export const CreateResultSchema = z.object({
  ok: z.literal(true),
  nodeId: z.string(),
  name: z.string(),
  type: z.string(),
});
export type CreateResult = z.infer<typeof CreateResultSchema>;

/** Result of a multi-node op (delete_nodes / …): which target ids were actually affected. */
export const BatchNodeResultSchema = z.object({
  ok: z.literal(true),
  affected: z.array(z.string()),
});
export type BatchNodeResult = z.infer<typeof BatchNodeResultSchema>;

/** Result of a style write (create_paint_style / update_paint_style / delete_style / …). */
export const StyleResultSchema = z.object({
  ok: z.literal(true),
  styleId: z.string(),
  name: z.string(),
});
export type StyleResult = z.infer<typeof StyleResultSchema>;

/** Result of create_variable_collection: the new collection + its auto-created default mode. */
export const CollectionResultSchema = z.object({
  ok: z.literal(true),
  collectionId: z.string(),
  defaultModeId: z.string(),
  name: z.string(),
});
export type CollectionResult = z.infer<typeof CollectionResultSchema>;

/** Result of delete_variable_collection: the removed collection's id + name. */
export const DeleteCollectionResultSchema = z.object({
  ok: z.literal(true),
  collectionId: z.string(),
  name: z.string(),
});
export type DeleteCollectionResult = z.infer<typeof DeleteCollectionResultSchema>;

/** Result of add_variable_mode: the new mode's id + name. */
export const ModeResultSchema = z.object({
  ok: z.literal(true),
  modeId: z.string(),
  name: z.string(),
});
export type ModeResult = z.infer<typeof ModeResultSchema>;

/** Result of a variable write (create_variable / set_variable_value / delete_variable / …). */
export const VariableResultSchema = z.object({
  ok: z.literal(true),
  variableId: z.string(),
  name: z.string(),
});
export type VariableResult = z.infer<typeof VariableResultSchema>;

/** One step in an atomic batch: a write tool name + the params it would normally receive. */
export const BatchOpSchema = z.object({
  tool: z.string(),
  params: z.unknown().optional(),
});
export type BatchOp = z.infer<typeof BatchOpSchema>;

/**
 * Result of `batch`: the per-op results in op order. The batch is all-or-nothing — on any failure
 * the plugin rolls back the already-applied ops and the call rejects instead of returning this.
 */
export const BatchResultSchema = z.object({
  ok: z.literal(true),
  results: z.array(z.unknown()),
});
export type BatchResult = z.infer<typeof BatchResultSchema>;
