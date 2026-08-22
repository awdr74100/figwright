import { z } from 'zod';

import { ResolvedTokenSchema } from './design-context.js';
// SerializedEffect / SerializedLayoutGrid / SerializedLineHeight / SerializedLetterSpacing now live
// in serialized-node.ts (shared by node + style serialization) and reach consumers via the barrel.
import {
  SerializedBindingsSchema,
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
  // AUTO | BALANCE | PRETTY — a text style carries its own wrap balancing, so a style named
  // "Heading/H1" can mean `text-wrap: balance` for every node bound to it.
  textWrapStyle: z.string(),
  /**
   * `field` → variable id for the typography fields Figma lets a text style bind (fontSize,
   * lineHeight, letterSpacing, fontFamily, fontStyle, fontWeight, paragraphSpacing,
   * paragraphIndent). Unlike a paint or effect style — whose bindings sit on the individual paint /
   * effect — a text style's values are scalars, so this is the only place its bindings exist.
   */
  boundVariables: SerializedBindingsSchema.optional(),
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
  /**
   * Id → token, for every variable id referenced by a `boundVariables` anywhere in this result —
   * the same id→name table get_design_context returns. Without it a binding is an opaque
   * `VariableID:5:12`; with it the consumer reads the token name (and any declared codeSyntax)
   * without a second round-trip. Names are NOT inlined into the bindings themselves: variable names
   * collide across collections (a local and a library `primary`), so the id stays the key. Omitted
   * when nothing in the document is bound.
   */
  variables: z.record(z.string(), ResolvedTokenSchema).optional(),
});
export type GetStylesResult = z.infer<typeof GetStylesResultSchema>;
