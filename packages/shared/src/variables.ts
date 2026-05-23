import * as v from 'valibot';

import { SerializedRGBASchema } from './serialized-node.js';

export const SerializedVariableAliasSchema = v.object({
  type: v.literal('VARIABLE_ALIAS'),
  id: v.string(),
});
export type SerializedVariableAlias = v.InferOutput<typeof SerializedVariableAliasSchema>;

/** A resolved value for one mode: primitive, color (RGB normalised to RGBA), or an alias to another variable. */
export const SerializedVariableValueSchema = v.union([
  v.boolean(),
  v.number(),
  v.string(),
  SerializedRGBASchema,
  SerializedVariableAliasSchema,
]);
export type SerializedVariableValue = v.InferOutput<typeof SerializedVariableValueSchema>;

export const SerializedVariableCollectionSchema = v.object({
  id: v.string(),
  name: v.string(),
  key: v.string(),
  defaultModeId: v.string(),
  modes: v.array(v.object({ modeId: v.string(), name: v.string() })),
  variableIds: v.array(v.string()),
});
export type SerializedVariableCollection = v.InferOutput<typeof SerializedVariableCollectionSchema>;

export const SerializedVariableSchema = v.object({
  id: v.string(),
  name: v.string(),
  key: v.string(),
  resolvedType: v.string(),
  collectionId: v.string(),
  valuesByMode: v.record(v.string(), SerializedVariableValueSchema),
});
export type SerializedVariable = v.InferOutput<typeof SerializedVariableSchema>;

export const GetVariableDefsResultSchema = v.object({
  collections: v.array(SerializedVariableCollectionSchema),
  variables: v.array(SerializedVariableSchema),
});
export type GetVariableDefsResult = v.InferOutput<typeof GetVariableDefsResultSchema>;
