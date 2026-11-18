import { z } from 'zod';

/** One documentation link, as Figma keeps it (a component, component set or style has at most one). */
export const DocumentationLinkInfoSchema = z.object({ uri: z.string() });
export type DocumentationLinkInfo = z.infer<typeof DocumentationLinkInfoSchema>;

/**
 * The documentation a component or component set carries beside its plain `description`. Both are
 * omitted when empty, so an entry without formatting or a link reads as it always did.
 */
const documentationExtras = {
  /**
   * The description as markdown — present only when it says something `description` cannot (bold, a
   * link, a list, paragraph breaks), i.e. when writing `description` back would lose it.
   */
  descriptionMarkdown: z.string().optional(),
  /** The documentation link (Figma keeps at most one). Omitted when there is none. */
  documentationLinks: z.array(DocumentationLinkInfoSchema).optional(),
};

export const SerializedComponentInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  key: z.string(),
  description: z.string(),
  ...documentationExtras,
  parentId: z.string().nullable(),
  /** Variant assignments for a component inside a set, e.g. { Size: "Large", State: "Hover" }. */
  variantProperties: z.record(z.string(), z.string()).optional(),
  /**
   * Figma's reason for withholding `variantProperties` when this variant's set has errors
   * ("Component set for node has existing errors"). Omitted when they read.
   */
  componentSetError: z.string().optional(),
});
export type SerializedComponentInfo = z.infer<typeof SerializedComponentInfoSchema>;

export const SerializedComponentSetInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  key: z.string(),
  description: z.string(),
  ...documentationExtras,
  /** Available values per variant axis, e.g. { Size: { values: ["Small", "Large"] } }. */
  variantGroupProperties: z
    .record(z.string(), z.object({ values: z.array(z.string()) }))
    .optional(),
  /**
   * Figma's reason for withholding `variantGroupProperties` when this set has errors ("Component
   * set has existing errors"). Omitted when they read.
   */
  componentSetError: z.string().optional(),
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
  /** The resolved component's / set's own description. Omitted when empty. */
  description: z.string().optional(),
  ...documentationExtras,
  /** Property name (verbatim, ready to pass to set_instance_properties) → its definition. */
  properties: z.record(z.string(), ComponentPropertyApiEntrySchema),
});
export type GetComponentApiResult = z.infer<typeof GetComponentApiResultSchema>;
