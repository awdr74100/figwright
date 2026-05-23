import * as v from 'valibot';

// SerializedEffect / SerializedLayoutGrid / SerializedLineHeight / SerializedLetterSpacing now live
// in serialized-node.ts (shared by node + style serialization) and reach consumers via the barrel.
import {
  SerializedEffectSchema,
  SerializedFontNameSchema,
  SerializedLayoutGridSchema,
  SerializedLetterSpacingSchema,
  SerializedLineHeightSchema,
  SerializedPaintSchema,
} from './serialized-node.js';

const styleBase = {
  id: v.string(),
  name: v.string(),
  key: v.string(),
  description: v.string(),
} as const;

export const SerializedPaintStyleSchema = v.object({
  ...styleBase,
  paints: v.array(SerializedPaintSchema),
});
export type SerializedPaintStyle = v.InferOutput<typeof SerializedPaintStyleSchema>;

export const SerializedTextStyleSchema = v.object({
  ...styleBase,
  fontName: SerializedFontNameSchema,
  fontSize: v.number(),
  lineHeight: SerializedLineHeightSchema,
  letterSpacing: SerializedLetterSpacingSchema,
});
export type SerializedTextStyle = v.InferOutput<typeof SerializedTextStyleSchema>;

export const SerializedEffectStyleSchema = v.object({
  ...styleBase,
  effects: v.array(SerializedEffectSchema),
});
export type SerializedEffectStyle = v.InferOutput<typeof SerializedEffectStyleSchema>;

export const SerializedGridStyleSchema = v.object({
  ...styleBase,
  grids: v.array(SerializedLayoutGridSchema),
});
export type SerializedGridStyle = v.InferOutput<typeof SerializedGridStyleSchema>;

export const GetStylesResultSchema = v.object({
  paints: v.array(SerializedPaintStyleSchema),
  texts: v.array(SerializedTextStyleSchema),
  effects: v.array(SerializedEffectStyleSchema),
  grids: v.array(SerializedGridStyleSchema),
});
export type GetStylesResult = v.InferOutput<typeof GetStylesResultSchema>;
