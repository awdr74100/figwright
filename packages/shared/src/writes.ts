import { z } from 'zod';

import { SerializedMeasurementSchema } from './queries.js';
import { FlowStartingPointSchema, SerializedAnnotationSchema } from './serialized-node.js';

// Write tools carry a server-generated requestId so the plugin can dedupe retries (idempotency).
// Inputs are validated per-tool in the plugin handlers; this module holds the shared result shapes.

/** Result of a property-mutation write (set_fills / set_text / …). */
export const MutateResultSchema = z.object({
  ok: z.literal(true),
  nodeId: z.string(),
});
export type MutateResult = z.infer<typeof MutateResultSchema>;

/**
 * Result of set_text_properties: the text's size once the call is applied. Font, size, spacing and
 * wrapping all move it, and a requested width / height can be held off by a min / max bound or an
 * instance, so the size is read back rather than assumed.
 */
export const TextPropertiesResultSchema = MutateResultSchema.extend({
  width: z.number(),
  height: z.number(),
  /**
   * Why the box is not what the call asked for: a min / max bound held its size, or Figma did not
   * apply the mode or line clamp. Absent when it is.
   */
  adjusted: z.string().optional(),
});
export type TextPropertiesResult = z.infer<typeof TextPropertiesResultSchema>;

/**
 * Result of set_layout_props. On a text, Figma keeps one truncation limit — a line count or a
 * maxHeight — and a fixed box shows no line count, so a call can clear a maxLines it never named;
 * `adjusted` says which and why. Absent when nothing beyond the call changed.
 */
export const LayoutPropsResultSchema = MutateResultSchema.extend({
  adjusted: z.string().optional(),
});
export type LayoutPropsResult = z.infer<typeof LayoutPropsResultSchema>;

/**
 * Result of set_layout_grids. A grid colour Figma would refuse is left out — the grid gets the
 * default — rather than failing every grid with it; `adjusted` names each. Absent when none was.
 */
export const LayoutGridsResultSchema = MutateResultSchema.extend({
  adjusted: z.string().optional(),
});
export type LayoutGridsResult = z.infer<typeof LayoutGridsResultSchema>;

/**
 * Result of set_component_documentation. Figma stores a description in its own form — surrounding
 * whitespace trimmed, line breaks as `\n`, everything from a NUL dropped, markdown rewritten — and
 * `adjusted` says which of those happened to this call. Absent when everything landed as sent.
 */
export const ComponentDocumentationResultSchema = MutateResultSchema.extend({
  adjusted: z.string().optional(),
});
export type ComponentDocumentationResult = z.infer<typeof ComponentDocumentationResultSchema>;

/**
 * Result of apply_animation_style: echoes the applied-style instance id Figma returns from
 * applyAnimationStyle. batch's inverse uses it to removeAnimationStyle on undo, so it must
 * round-trip.
 */
export const ApplyAnimationStyleResultSchema = z.object({
  ok: z.literal(true),
  nodeId: z.string(),
  appliedStyleId: z.string(),
});
export type ApplyAnimationStyleResult = z.infer<typeof ApplyAnimationStyleResultSchema>;

/** Result of a node-creation write (create_frame / …): the new node's id + identity. */
export const CreateResultSchema = z.object({
  ok: z.literal(true),
  nodeId: z.string(),
  name: z.string(),
  type: z.string(),
});
export type CreateResult = z.infer<typeof CreateResultSchema>;

/**
 * Result of create_text: the size the text came out at. Unlike a frame's or a shape's, a text box's
 * size follows from its content, font and wrapping, so the caller cannot know it in advance.
 */
export const CreateTextResultSchema = CreateResultSchema.extend({
  width: z.number(),
  height: z.number(),
  /** What did not land as asked — set_text_properties' `adjusted`. Absent when everything did. */
  adjusted: z.string().optional(),
});
export type CreateTextResult = z.infer<typeof CreateTextResultSchema>;

/** Result of a multi-node op (delete_nodes / …): which target ids were actually affected. */
/** Set_image_fill: the fill it wrote, and the image's size in pixels. */
export const ImageFillResultSchema = z.object({
  ok: z.literal(true),
  nodeId: z.string(),
  index: z.number(),
  imageHash: z.string(),
  width: z.number(),
  height: z.number(),
});
export type ImageFillResult = z.infer<typeof ImageFillResultSchema>;

export const BatchNodeResultSchema = z.object({
  ok: z.literal(true),
  affected: z.array(z.string()),
});
export type BatchNodeResult = z.infer<typeof BatchNodeResultSchema>;

/**
 * Result of resize_nodes. `affected` lists only the nodes that ended at exactly the requested size;
 * a node Figma sized differently — a min/max bound held it, or it sits inside an instance and kept
 * the size its main component gives it — is listed in `adjusted` with the size it actually has and
 * why, since `resize()` reports neither on its own.
 */
export const ResizeNodesResultSchema = BatchNodeResultSchema.extend({
  adjusted: z
    .array(
      z.object({
        nodeId: z.string(),
        width: z.number(),
        height: z.number(),
        reason: z.string(),
      }),
    )
    .optional(),
  /**
   * Texts that reached their size but lost a maxLines line clamp on the way: a new height makes a
   * fixed box, which shows no line count. Absent when none did.
   */
  cleared: z.array(z.object({ nodeId: z.string(), reason: z.string() })).optional(),
});
export type ResizeNodesResult = z.infer<typeof ResizeNodesResultSchema>;

/** Result of a style write (create_paint_style / update_paint_style / delete_style / …). */
export const StyleResultSchema = z.object({
  ok: z.literal(true),
  styleId: z.string(),
  name: z.string(),
  /** What did not land as sent — a grid style's colour Figma would refuse. Absent when all did. */
  adjusted: z.string().optional(),
});
export type StyleResult = z.infer<typeof StyleResultSchema>;

/** Result of create_variable_collection: the new collection + its auto-created default mode. */
export const CollectionResultSchema = z.object({
  ok: z.literal(true),
  collectionId: z.string(),
  defaultModeId: z.string(),
  name: z.string(),
  /** Whether the new collection is left out of the published library (create_variable_collection). */
  hiddenFromPublishing: z.boolean().optional(),
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

/**
 * Result of update_variable_collection: the collection as it now stands. The whole mode list comes
 * back, not just the renamed ones, so a caller that changed some of them can see the result without
 * reading the collection again. The ids are echoed to make the point the write relies on: renaming
 * changes no id, so every binding survives.
 */
export const UpdateCollectionResultSchema = z.object({
  ok: z.literal(true),
  collectionId: z.string(),
  name: z.string(),
  modes: z.array(z.object({ modeId: z.string(), name: z.string() })),
  /** The collection's publishing flag as it now stands — present when the call set it. */
  hiddenFromPublishing: z.boolean().optional(),
});
export type UpdateCollectionResult = z.infer<typeof UpdateCollectionResultSchema>;

/**
 * Result of delete_variable_mode: the removed mode's id and name, plus the collection it left. The
 * name is echoed because the caller only supplies an id — it is the confirmation that the mode
 * removed was the intended one, and the id cannot be looked up afterwards.
 */
export const DeleteModeResultSchema = z.object({
  ok: z.literal(true),
  collectionId: z.string(),
  modeId: z.string(),
  name: z.string(),
});
export type DeleteModeResult = z.infer<typeof DeleteModeResultSchema>;

/**
 * Result of update_flows: the page's flow list as Figma reads it back after the write, in order —
 * the whole list, not just the entries this call touched, so the caller sees which flow is now the
 * default (the first) without reading the page again.
 */
export const UpdateFlowsResultSchema = z.object({
  ok: z.literal(true),
  pageId: z.string(),
  flows: z.array(FlowStartingPointSchema),
});
export type UpdateFlowsResult = z.infer<typeof UpdateFlowsResultSchema>;

/** Result of a variable write (create_variable / set_variable_value / delete_variable / …). */
export const VariableResultSchema = z.object({
  ok: z.literal(true),
  variableId: z.string(),
  name: z.string(),
  /** The per-platform declarations now in effect (set_variable_code_syntax echoes them back). */
  codeSyntax: z.record(z.string(), z.string()).optional(),
  /** What Figma stored differently from what was sent (a trimmed description, …). */
  adjusted: z.string().optional(),
});
export type VariableResult = z.infer<typeof VariableResultSchema>;

/** Result of set_node_variable_mode: the mode now explicit on the node, or null once cleared. */
export const VariableModeResultSchema = z.object({
  ok: z.literal(true),
  nodeId: z.string(),
  collectionId: z.string(),
  collectionName: z.string(),
  modeId: z.string().nullable(),
  modeName: z.string().nullable(),
});
export type VariableModeResult = z.infer<typeof VariableModeResultSchema>;

/**
 * Result of a component-property authoring write (add / edit / delete_component_property). The
 * propertyId is the name-with-unique-suffix ("Show Icon#12:5") Figma assigns — the handle every
 * later bind / edit / delete and set_instance_properties call must use, so it's echoed back.
 */
export const ComponentPropertyResultSchema = z.object({
  ok: z.literal(true),
  componentId: z.string(),
  propertyId: z.string(),
  name: z.string(),
});
export type ComponentPropertyResult = z.infer<typeof ComponentPropertyResultSchema>;

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

/** Result of set_annotations: the node's annotations as Figma now holds them. */
export const AnnotationsResultSchema = z.object({
  ok: z.literal(true),
  nodeId: z.string(),
  annotations: z.array(SerializedAnnotationSchema),
  /** What Figma stored differently from what was sent (a trimmed label, rewritten markdown). */
  adjusted: z.string().optional(),
});
export type AnnotationsResult = z.infer<typeof AnnotationsResultSchema>;

/** Result of create_annotation_category / update_annotation_category. */
export const AnnotationCategoryResultSchema = z.object({
  ok: z.literal(true),
  categoryId: z.string(),
  label: z.string(),
  color: z.string(),
  isPreset: z.boolean(),
});
export type AnnotationCategoryResult = z.infer<typeof AnnotationCategoryResultSchema>;

/** Result of delete_annotation_category. */
export const DeleteAnnotationCategoryResultSchema = z.object({
  ok: z.literal(true),
  categoryId: z.string(),
  label: z.string(),
});
export type DeleteAnnotationCategoryResult = z.infer<typeof DeleteAnnotationCategoryResultSchema>;

/** Result of add_measurement / update_measurement: the measurement as Figma now holds it. */
export const MeasurementResultSchema = SerializedMeasurementSchema.omit({ id: true }).extend({
  ok: z.literal(true),
  /** The measurement's id — what update_measurement and delete_measurement take. */
  measurementId: z.string(),
  /** The page it lives on. */
  pageId: z.string(),
});
export type MeasurementResult = z.infer<typeof MeasurementResultSchema>;

/** Result of delete_measurement. */
export const DeleteMeasurementResultSchema = z.object({
  ok: z.literal(true),
  measurementId: z.string(),
  pageId: z.string(),
});
export type DeleteMeasurementResult = z.infer<typeof DeleteMeasurementResultSchema>;
