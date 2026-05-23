import * as v from 'valibot';

export const SerializedComponentInfoSchema = v.object({
  id: v.string(),
  name: v.string(),
  key: v.string(),
  description: v.string(),
  parentId: v.nullable(v.string()),
  /** Variant assignments for a component inside a set, e.g. { Size: "Large", State: "Hover" }. */
  variantProperties: v.exactOptional(v.record(v.string(), v.string())),
});
export type SerializedComponentInfo = v.InferOutput<typeof SerializedComponentInfoSchema>;

export const SerializedComponentSetInfoSchema = v.object({
  id: v.string(),
  name: v.string(),
  key: v.string(),
  description: v.string(),
  /** Available values per variant axis, e.g. { Size: { values: ["Small", "Large"] } }. */
  variantGroupProperties: v.exactOptional(
    v.record(v.string(), v.object({ values: v.array(v.string()) })),
  ),
  componentIds: v.array(v.string()),
});
export type SerializedComponentSetInfo = v.InferOutput<typeof SerializedComponentSetInfoSchema>;

export const GetLocalComponentsResultSchema = v.object({
  components: v.array(SerializedComponentInfoSchema),
  componentSets: v.array(SerializedComponentSetInfoSchema),
});
export type GetLocalComponentsResult = v.InferOutput<typeof GetLocalComponentsResultSchema>;
