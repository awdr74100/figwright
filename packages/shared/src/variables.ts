import { z } from 'zod';

import { SerializedRGBASchema } from './serialized-node.js';

export const SerializedVariableAliasSchema = z.object({
  type: z.literal('VARIABLE_ALIAS'),
  id: z.string(),
});
export type SerializedVariableAlias = z.infer<typeof SerializedVariableAliasSchema>;

/**
 * A COLOR variable value: RGBA plus a convenience `hex` (#RRGGBB / #RRGGBBAA, alpha only when < 1)
 * mirroring the hex that get_design_context's globalVars already emits — so an agent reading a
 * bound variable's color needn't convert normalised RGBA by hand or cross to a second tool. RGBA
 * stays for back-compat (token_map and other consumers read the channels directly).
 */
export const SerializedVariableColorSchema = SerializedRGBASchema.extend({
  hex: z.string().optional(),
});

/**
 * A resolved value for one mode: primitive, color (RGB normalised to RGBA + hex), or an alias to
 * another variable.
 */
export const SerializedVariableValueSchema = z.union([
  z.boolean(),
  z.number(),
  z.string(),
  SerializedVariableColorSchema,
  SerializedVariableAliasSchema,
]);
export type SerializedVariableValue = z.infer<typeof SerializedVariableValueSchema>;

export const SerializedVariableCollectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  key: z.string(),
  defaultModeId: z.string(),
  modes: z.array(z.object({ modeId: z.string(), name: z.string() })),
  variableIds: z.array(z.string()),
});
export type SerializedVariableCollection = z.infer<typeof SerializedVariableCollectionSchema>;

export const SerializedVariableSchema = z.object({
  id: z.string(),
  name: z.string(),
  key: z.string(),
  resolvedType: z.string(),
  collectionId: z.string(),
  valuesByMode: z.record(z.string(), SerializedVariableValueSchema),
});
export type SerializedVariable = z.infer<typeof SerializedVariableSchema>;

export const GetVariableDefsResultSchema = z.object({
  collections: z.array(SerializedVariableCollectionSchema),
  variables: z.array(SerializedVariableSchema),
});
export type GetVariableDefsResult = z.infer<typeof GetVariableDefsResultSchema>;
