import { z } from 'zod';

export const SerializedComponentInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  key: z.string(),
  description: z.string(),
  parentId: z.string().nullable(),
  /** Variant assignments for a component inside a set, e.g. { Size: "Large", State: "Hover" }. */
  variantProperties: z.record(z.string(), z.string()).optional(),
});
export type SerializedComponentInfo = z.infer<typeof SerializedComponentInfoSchema>;

export const SerializedComponentSetInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  key: z.string(),
  description: z.string(),
  /** Available values per variant axis, e.g. { Size: { values: ["Small", "Large"] } }. */
  variantGroupProperties: z
    .record(z.string(), z.object({ values: z.array(z.string()) }))
    .optional(),
  componentIds: z.array(z.string()),
});
export type SerializedComponentSetInfo = z.infer<typeof SerializedComponentSetInfoSchema>;

export const GetLocalComponentsResultSchema = z.object({
  components: z.array(SerializedComponentInfoSchema),
  componentSets: z.array(SerializedComponentSetInfoSchema),
});
export type GetLocalComponentsResult = z.infer<typeof GetLocalComponentsResultSchema>;

/**
 * One entry of a component's property contract (Figma's `componentPropertyDefinitions`). The key in
 * the containing record is the property name exactly as `setProperties` expects it: a bare name for
 * VARIANT, suffixed `#<id>` for BOOLEAN / TEXT / INSTANCE_SWAP.
 */
export const ComponentPropertyApiEntrySchema = z.object({
  type: z.enum(['BOOLEAN', 'TEXT', 'INSTANCE_SWAP', 'VARIANT', 'SLOT']),
  defaultValue: z.union([z.string(), z.boolean()]),
  /** VARIANT only: the allowed values for this axis, e.g. ["sm", "md", "lg"]. */
  variantOptions: z.array(z.string()).optional(),
  /** INSTANCE_SWAP only: suggested swap targets as published component/set keys. */
  preferredValues: z
    .array(z.object({ type: z.enum(['COMPONENT', 'COMPONENT_SET']), key: z.string() }))
    .optional(),
  description: z.string().optional(),
});
export type ComponentPropertyApiEntry = z.infer<typeof ComponentPropertyApiEntrySchema>;

/** Result of get_component_api: a resolved component/set and its full, verbatim-keyed property API. */
export const GetComponentApiResultSchema = z.object({
  /** The resolved component / component set id (an instance resolves to its main component / set). */
  id: z.string(),
  name: z.string(),
  type: z.string(),
  /** Property name (verbatim, ready to pass to set_instance_properties) → its definition. */
  properties: z.record(z.string(), ComponentPropertyApiEntrySchema),
});
export type GetComponentApiResult = z.infer<typeof GetComponentApiResultSchema>;
