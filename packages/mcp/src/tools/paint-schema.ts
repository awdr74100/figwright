import { z } from 'zod';

import { boundVariablesSchema } from './binding-schema.js';
import { colorSpaceSchema } from './color-space-schema.js';

// Shared Zod paint schema, reused by set_fills / set_strokes / create_paint_style /
// update_paint_style so the SOLID + gradient shape can't drift between them. Loose (only `type` is
// required and unknown keys pass through) so a paint read back from get_node round-trips into a
// write unchanged — matching the previous hand-written schema, which set no additionalProperties.
// The plugin's toFigmaPaint does the real enforcement (a gradient must carry gradientStops + a 2×3
// gradientTransform; unsupported types are rejected). A read-back gradient also carries the derived
// `cssAngle`; it rides through on the loose shape and is ignored, and it stays OUT of the declared
// arguments on purpose — it is not an input, and declaring it would register a plugin-facing
// argument that no plugin version will ever honour.

const rgb = z.object({
  r: z.number(),
  g: z.number(),
  b: z.number(),
  space: colorSpaceSchema.optional(),
});
const rgba = z.object({
  r: z.number(),
  g: z.number(),
  b: z.number(),
  a: z.number(),
  space: colorSpaceSchema.optional(),
});

/** One paint: SOLID (color) or a gradient (gradientStops + gradientTransform). */
export const paintItemSchema = z
  .object({
    type: z.enum([
      'SOLID',
      'GRADIENT_LINEAR',
      'GRADIENT_RADIAL',
      'GRADIENT_ANGULAR',
      'GRADIENT_DIAMOND',
    ]),
    color: rgb.describe('SOLID color (r/g/b in 0–1)').optional(),
    gradientStops: z
      .array(
        z.object({
          position: z.number(),
          color: rgba,
          // A stop binds its colour independently of its siblings, so the binding rides here.
          boundVariables: boundVariablesSchema.optional(),
        }),
      )
      .describe('Gradient stops (position 0–1 + RGBA color); required for gradient types')
      .optional(),
    gradientTransform: z
      .array(z.array(z.number()))
      .describe('2×3 affine matrix (two rows of three) positioning the gradient')
      .optional(),
    opacity: z.number().optional(),
    visible: z.boolean().optional(),
    // The opacity rule is Figma's, measured on every tool that takes this schema (set_fills,
    // set_strokes, set_text_range, create_paint_style, update_paint_style): a bound paint's opacity
    // is replaced by the variable's alpha when written, even when given explicitly.
    boundVariables: boundVariablesSchema
      .describe(
        'SOLID only: { "color": variableId } binds the paint colour to a COLOR variable, whose ' +
          'alpha then replaces opacity.',
      )
      .optional(),
  })
  .loose();

/**
 * A node fill or stroke: everything {@link paintItemSchema} takes, plus PATTERN — a source node
 * tiled across the paint (Figma Draw). Kept apart from the shared schema on purpose: a paint style
 * and a text run cannot hold a pattern (the plugin API offers no setter that accepts one there), so
 * only the node-level paint tools advertise it.
 */
export const fillPaintItemSchema = paintItemSchema
  .extend({
    type: z.enum([
      'SOLID',
      'GRADIENT_LINEAR',
      'GRADIENT_RADIAL',
      'GRADIENT_ANGULAR',
      'GRADIENT_DIAMOND',
      'PATTERN',
    ]),
    sourceNodeId: z
      .string()
      .describe('PATTERN: the node whose artwork is tiled (any layer in the file)')
      .optional(),
    tileType: z
      .enum(['RECTANGULAR', 'HORIZONTAL_HEXAGONAL', 'VERTICAL_HEXAGONAL'])
      .describe('PATTERN: a plain grid, or rows / columns offset by half a tile')
      .optional(),
    scalingFactor: z
      .number()
      .positive()
      .describe('PATTERN: the tile’s size as a multiple of the source node’s (default 1)')
      .optional(),
    spacing: z
      .object({ x: z.number(), y: z.number() })
      .describe('PATTERN: the gap between tiles as a fraction of the tile’s size (default 0, 0)')
      .optional(),
    horizontalAlignment: z
      .enum(['START', 'CENTER', 'END'])
      .describe('PATTERN: where the tiling is anchored horizontally (default START)')
      .optional(),
    verticalAlignment: z
      .enum(['START', 'CENTER', 'END'])
      .describe('PATTERN: where the tiling is anchored vertically (default START)')
      .optional(),
  })
  .loose();
