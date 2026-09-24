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
export type SerializedVariableColor = z.infer<typeof SerializedVariableColorSchema>;

/**
 * A composed color — plugin-typings 1.139 widened VariableValue again: a color and its opacity
 * authored separately, with at least one of the two an alias (a shared colour reused at several
 * opacities without duplicating the colour itself).
 *
 * It carries no `type`, so before this member existed it fell through to the plain-colour branch of
 * every reader and came out as `r`/`g`/`b`: undefined behind a fabricated `#NANNANNAN` hex
 * (measured) — the same trap the easing member below was added to close.
 *
 * Mirrored as Figma shapes it rather than pre-flattened, so an agent can still see which half is
 * the alias and hand the value straight back to set_variable_value. token_map flattens it to a
 * single hex instead (see resolveFigmaTokens), because a token value is one scalar.
 */
export const SerializedVariableComposedColorSchema = z.object({
  color: z.union([SerializedVariableColorSchema, SerializedVariableAliasSchema]),
  opacity: z.union([z.number(), SerializedVariableAliasSchema]),
});
export type SerializedVariableComposedColor = z.infer<typeof SerializedVariableComposedColorSchema>;

/** A cubic-bezier control pair — Figma's EasingFunctionBezier, present only for CUSTOM_CUBIC_BEZIER. */
export const SerializedEasingBezierSchema = z.object({
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
});

/** A normalised spring — Figma's NormalizedSpring (0–1 bounce), present only for CUSTOM_SPRING. */
export const SerializedEasingSpringSchema = z.object({ bounce: z.number() });

/**
 * An EASING variable's value. plugin-typings 1.133 widened VariableValue to admit MotionEasing, so
 * a variable can now hold an easing curve rather than only primitives/colors/aliases.
 *
 * Mirrored field-for-field on purpose: what get_variable_defs emits can be handed straight back to
 * set_variable_value. `type` stays a plain string rather than an enum of the 14 members Figma
 * currently ships — this file is a hand-written mirror with no compile-time coupling to the
 * typings, so a narrow enum here would silently reject any easing type a future release adds.
 */
export const SerializedMotionEasingSchema = z.object({
  type: z.string(),
  easingFunctionCubicBezier: SerializedEasingBezierSchema.optional(),
  easingFunctionSpring: SerializedEasingSpringSchema.optional(),
});
export type SerializedMotionEasing = z.infer<typeof SerializedMotionEasingSchema>;

/**
 * A resolved value for one mode: primitive, color (RGB normalised to RGBA + hex), an alias to
 * another variable, or an easing curve.
 *
 * Order matters: the alias member must be tried before the easing member. Both are objects carrying
 * a `type`, and easing's `type` is a permissive string, so an alias reaching the easing member
 * first would match it and lose its `id`. The composed-colour member is keyed by `color`/`opacity`
 * and carries no `type` of its own, so it cannot collide with either and sits beside the plain
 * colour it is a variant of.
 */
export const SerializedVariableValueSchema = z.union([
  z.boolean(),
  z.number(),
  z.string(),
  SerializedVariableColorSchema,
  SerializedVariableComposedColorSchema,
  SerializedVariableAliasSchema,
  SerializedMotionEasingSchema,
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
  /**
   * Designer-declared code-side name per platform (WEB / ANDROID / iOS → e.g. `--color-primary`) —
   * authoritative naming intent that skips the heuristic Figma-name → code-token join when present.
   * Omitted when the variable declares none.
   */
  codeSyntax: z.record(z.string(), z.string()).optional(),
  /**
   * Where Figma offers this variable in its picker (`ALL_FILLS`, `CORNER_RADIUS`, `GAP`, …) — the
   * designer's own statement of what the token is _for_, which a name-based join can only guess at
   * (a `size/4` scoped to CORNER_RADIUS is not the same token as one scoped to GAP).
   *
   * Omitted when it is Figma's default `['ALL_SCOPES']`: that is what every untouched variable
   * carries, so emitting it would cost payload on every variable in the file and mean nothing.
   * Presence therefore signals a deliberate narrowing.
   *
   * Plain strings rather than an enum, for the same reason as the easing `type` above: this file is
   * a hand-written mirror with no compile-time coupling to the typings (1.139 added COLOR_OPACITY),
   * and a narrow enum here would silently reject a scope a future release adds.
   */
  scopes: z.array(z.string()).optional(),
});
export type SerializedVariable = z.infer<typeof SerializedVariableSchema>;

export const GetVariableDefsResultSchema = z.object({
  collections: z.array(SerializedVariableCollectionSchema),
  variables: z.array(SerializedVariableSchema),
});
export type GetVariableDefsResult = z.infer<typeof GetVariableDefsResultSchema>;
