import { z } from 'zod';

import { SerializedRGBASchema } from './serialized-node.js';

export const SerializedVariableAliasSchema = z.object({
  type: z.literal('VARIABLE_ALIAS'),
  id: z.string(),
});
export type SerializedVariableAlias = z.infer<typeof SerializedVariableAliasSchema>;

/**
 * A resolved value for one mode: primitive, color (RGB normalised to RGBA), or an alias to another
 * variable.
 */
export const SerializedVariableValueSchema = z.union([
  z.boolean(),
  z.number(),
  z.string(),
  SerializedRGBASchema,
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
