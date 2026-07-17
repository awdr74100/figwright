import { z } from 'zod';

// Shared, grounded Zod schemas for Figma's Motion API (beta). Reused by every apply_* / set_* Motion
// tool so the keyframe / easing / config shape can't drift between them. This is our edge over the
// competitor's raw port (gethopp #38), which types field / track / config as z.record(z.unknown()) —
// the LLM cannot author reliably against `unknown`. Modeling the real typed shape (mostly enums) is
// cheap and turns blind guessing into reliable authoring. Mirrors @figma/plugin-typings 1.131
// (MotionEasing / KeyframeValue / KeyframeField / ManualKeyframeTrackInput / AnimationStyleConfiguration).
//
// Idiom, matching the rest of the repo: keep these schemas simple (enum + describe + basic bounds)
// and defer cross-field semantics (e.g. "an effects field needs `field` or `propertyId`") to the
// hand-written type-guards in the plugin handlers — the repo does not use Zod .superRefine / .refine.

const rgba = z
  .object({
    r: z.number().min(0).max(1),
    g: z.number().min(0).max(1),
    b: z.number().min(0).max(1),
    a: z.number().min(0).max(1),
  })
  .describe('Color as RGBA channels 0–1');

// MotionEasing.type — 14 presets. Named presets (EASE_*, GENTLE/QUICK/BOUNCY/SLOW, LINEAR, HOLD) need
// no extra params; CUSTOM_CUBIC_BEZIER pairs with easingFunctionCubicBezier, CUSTOM_SPRING with a
// normalized 0–1 bounce.
export const MOTION_EASING_TYPES = [
  'EASE_IN',
  'EASE_OUT',
  'EASE_IN_AND_OUT',
  'LINEAR',
  'EASE_IN_BACK',
  'EASE_OUT_BACK',
  'EASE_IN_AND_OUT_BACK',
  'CUSTOM_CUBIC_BEZIER',
  'GENTLE',
  'QUICK',
  'BOUNCY',
  'SLOW',
  'CUSTOM_SPRING',
  'HOLD',
] as const;

export const motionEasingSchema = z
  .object({
    type: z.enum(MOTION_EASING_TYPES),
    easingFunctionCubicBezier: z
      .object({ x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() })
      .describe('Bezier control points; only for type "CUSTOM_CUBIC_BEZIER"')
      .optional(),
    easingFunctionSpring: z
      .object({ bounce: z.number().min(0).max(1) })
      .describe('Normalized bounce 0–1; only for type "CUSTOM_SPRING"')
      .optional(),
  })
  .describe(
    'Motion easing: a named preset, or CUSTOM_CUBIC_BEZIER / CUSTOM_SPRING with its params',
  );

// KeyframeValue — discriminated on `type`. FLOAT/BOOL/TEXT_DATA cover most property animations;
// COLOR / VECTOR / the geometric point types cover paint stops and vector fields.
export const keyframeValueSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('FLOAT'), value: z.number() }),
    z.object({ type: z.literal('COLOR'), value: rgba }),
    z.object({ type: z.literal('TEXT_DATA'), value: z.string() }),
    z.object({ type: z.literal('VECTOR'), value: z.object({ x: z.number(), y: z.number() }) }),
    z.object({ type: z.literal('BOOL'), value: z.boolean() }),
    z.object({
      type: z.literal('CIRCLE'),
      value: z.object({ x: z.number(), y: z.number(), radius: z.number() }),
    }),
    z.object({
      type: z.literal('LINE'),
      value: z.object({ x: z.number(), y: z.number(), x2: z.number(), y2: z.number() }),
    }),
    z.object({
      type: z.literal('CIRCLE_POINT'),
      value: z.object({ x: z.number(), y: z.number(), radius: z.number(), angle: z.number() }),
    }),
    z.object({
      type: z.literal('COLOR_POINT'),
      value: z.object({ x: z.number(), y: z.number(), color: rgba }),
    }),
  ])
  .describe(
    'A keyframe value tagged by its animated field type (FLOAT for translate/scale/opacity, …)',
  );

export const manualKeyframeInputSchema = z.object({
  id: z.string().optional(),
  timelinePosition: z.number().describe('Keyframe position on the timeline, in seconds'),
  easing: motionEasingSchema.optional(),
  value: keyframeValueSchema,
});

export const manualKeyframeTrackInputSchema = z.object({
  id: z.string().optional(),
  baseValue: keyframeValueSchema.describe('The value before the first keyframe').optional(),
  keyframes: z.array(manualKeyframeInputSchema).min(1).describe('Keyframes in timeline order'),
});

// KeyframePropertyFieldName — 30 animatable node properties.
export const KEYFRAME_PROPERTY_FIELDS = [
  'CORNER_RADIUS',
  'STROKE_WEIGHT',
  'STACK_SPACING',
  'STACK_PADDING_LEFT',
  'STACK_PADDING_TOP',
  'STACK_PADDING_RIGHT',
  'STACK_PADDING_BOTTOM',
  'WIDTH',
  'HEIGHT',
  'RECTANGLE_TOP_LEFT_CORNER_RADIUS',
  'RECTANGLE_TOP_RIGHT_CORNER_RADIUS',
  'RECTANGLE_BOTTOM_LEFT_CORNER_RADIUS',
  'RECTANGLE_BOTTOM_RIGHT_CORNER_RADIUS',
  'BORDER_TOP_WEIGHT',
  'BORDER_BOTTOM_WEIGHT',
  'BORDER_LEFT_WEIGHT',
  'BORDER_RIGHT_WEIGHT',
  'STACK_COUNTER_SPACING',
  'OPACITY',
  'GRID_ROW_GAP',
  'GRID_COLUMN_GAP',
  'TRANSLATION_X',
  'TRANSLATION_Y',
  'TRANSLATION_XY',
  'ROTATION',
  'SCALE_X',
  'SCALE_Y',
  'SCALE_XY',
  'PATH_TRIM_START',
  'PATH_TRIM_END',
] as const;

// EffectKeyframeFieldName — 17 animatable effect sub-fields (shadow offset/radius, noise, glass, …).
export const EFFECT_KEYFRAME_FIELDS = [
  'OFFSET_X',
  'OFFSET_Y',
  'RADIUS',
  'SPREAD',
  'COLOR',
  'REFRACTION_RADIUS',
  'SPECULAR_ANGLE',
  'SPECULAR_INTENSITY',
  'CHROMATIC_ABERRATION',
  'SPLAY',
  'REFRACTION_INTENSITY',
  'START_RADIUS',
  'NOISE_SIZE_X',
  'NOISE_SIZE_Y',
  'DENSITY',
  'EFFECT_OPACITY',
  'SECONDARY_COLOR',
] as const;

// KeyframeField — what a track animates. A top-level node PROPERTY, or an INDEXED_ITEM inside the
// node's fills / strokes / effects. The typings split INDEXED_ITEM into paint vs effect variants; we
// collapse them into one loose branch and let the plugin handler enforce "effects need `field` or
// `propertyId`; fills/strokes take neither `field`". Discriminated on `type` for good top-level errors.
export const keyframeFieldSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('PROPERTY'), name: z.enum(KEYFRAME_PROPERTY_FIELDS) }),
    z.object({
      type: z.literal('INDEXED_ITEM'),
      collection: z.enum(['fills', 'strokes', 'effects']),
      index: z.number().int().min(0),
      field: z
        .enum(EFFECT_KEYFRAME_FIELDS)
        .describe('Effect sub-field to animate; only when collection is "effects"')
        .optional(),
      propertyId: z
        .string()
        .describe('Animate a bound component-property on the paint/effect instead of a field')
        .optional(),
    }),
  ])
  .describe(
    'Which field a keyframe track drives: a node PROPERTY or an INDEXED_ITEM in fills/strokes/effects',
  );

// AnimationStyleConfiguration — how an applied preset is tuned. `timelineOffset` is the lever for
// staggered entrances (give each node index * step). VariableAlias-valued props are not modeled yet.
export const animationStyleConfigSchema = z.object({
  duration: z.number().positive().describe('Duration in seconds').optional(),
  timelineOffset: z
    .number()
    .describe('Start offset in seconds; use index * step for staggered entrances')
    .optional(),
  props: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), motionEasingSchema]))
    .describe('Preset-specific props (e.g. direction, distance, easing) keyed by prop name')
    .optional(),
});

// Video export size constraint (export_video). SCALE is a multiplier from the standard Export-panel
// scales; WIDTH / HEIGHT pin the output to a fixed pixel size. Mirrors VideoExportConstraint.
export const videoExportConstraintSchema = z
  .union([
    z.object({
      type: z.literal('SCALE'),
      value: z.union([
        z.literal(0.5),
        z.literal(0.75),
        z.literal(1),
        z.literal(1.5),
        z.literal(2),
        z.literal(3),
        z.literal(4),
      ]),
    }),
    z.object({ type: z.literal('WIDTH'), value: z.number().positive() }),
    z.object({ type: z.literal('HEIGHT'), value: z.number().positive() }),
  ])
  .describe('Output size: a SCALE multiplier (0.5/0.75/1/1.5/2/3/4) or a fixed WIDTH/HEIGHT in px');
