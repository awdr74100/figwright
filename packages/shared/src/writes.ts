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

/** Result of a style write (create_paint_style / update_paint_style / delete_style / …). */
export const StyleResultSchema = v.object({
  ok: v.literal(true),
  styleId: v.string(),
  name: v.string(),
});
export type StyleResult = v.InferOutput<typeof StyleResultSchema>;

/** Result of create_variable_collection: the new collection + its auto-created default mode. */
export const CollectionResultSchema = v.object({
  ok: v.literal(true),
  collectionId: v.string(),
  defaultModeId: v.string(),
  name: v.string(),
});
export type CollectionResult = v.InferOutput<typeof CollectionResultSchema>;

/** Result of add_variable_mode: the new mode's id + name. */
export const ModeResultSchema = v.object({
  ok: v.literal(true),
  modeId: v.string(),
  name: v.string(),
});
export type ModeResult = v.InferOutput<typeof ModeResultSchema>;

/** Result of a variable write (create_variable / set_variable_value / delete_variable / …). */
export const VariableResultSchema = v.object({
  ok: v.literal(true),
  variableId: v.string(),
  name: v.string(),
});
export type VariableResult = v.InferOutput<typeof VariableResultSchema>;
