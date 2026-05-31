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
