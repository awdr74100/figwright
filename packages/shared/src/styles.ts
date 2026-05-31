import { z } from 'zod';

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
  id: z.string(),
  name: z.string(),
  key: z.string(),
  description: z.string(),
} as const;

export const SerializedPaintStyleSchema = z.object({
  ...styleBase,
  paints: z.array(SerializedPaintSchema),
});
export type SerializedPaintStyle = z.infer<typeof SerializedPaintStyleSchema>;

export const SerializedTextStyleSchema = z.object({
  ...styleBase,
  fontName: SerializedFontNameSchema,
  fontSize: z.number(),
  lineHeight: SerializedLineHeightSchema,
  letterSpacing: SerializedLetterSpacingSchema,
});
export type SerializedTextStyle = z.infer<typeof SerializedTextStyleSchema>;

export const SerializedEffectStyleSchema = z.object({
  ...styleBase,
  effects: z.array(SerializedEffectSchema),
});
export type SerializedEffectStyle = z.infer<typeof SerializedEffectStyleSchema>;

export const SerializedGridStyleSchema = z.object({
  ...styleBase,
  grids: z.array(SerializedLayoutGridSchema),
});
export type SerializedGridStyle = z.infer<typeof SerializedGridStyleSchema>;

export const GetStylesResultSchema = z.object({
  paints: z.array(SerializedPaintStyleSchema),
  texts: z.array(SerializedTextStyleSchema),
  effects: z.array(SerializedEffectStyleSchema),
  grids: z.array(SerializedGridStyleSchema),
});
export type GetStylesResult = z.infer<typeof GetStylesResultSchema>;
