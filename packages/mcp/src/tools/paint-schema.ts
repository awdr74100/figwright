import { z } from 'zod';

// Shared Zod paint schema, reused by set_fills / set_strokes / create_paint_style /
// update_paint_style so the SOLID + gradient shape can't drift between them. Loose (only `type` is
// required and unknown keys pass through) so a paint read back from get_node round-trips into a
// write unchanged — matching the previous hand-written schema, which set no additionalProperties.
// The plugin's toFigmaPaint does the real enforcement (a gradient must carry gradientStops + a 2×3
// gradientTransform; unsupported types are rejected).

const rgb = z.object({ r: z.number(), g: z.number(), b: z.number() });
const rgba = z.object({ r: z.number(), g: z.number(), b: z.number(), a: z.number() });

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
      .array(z.object({ position: z.number(), color: rgba }))
      .describe('Gradient stops (position 0–1 + RGBA color); required for gradient types')
      .optional(),
    gradientTransform: z
      .array(z.array(z.number()))
      .describe('2×3 affine matrix (two rows of three) positioning the gradient')
      .optional(),
    opacity: z.number().optional(),
    visible: z.boolean().optional(),
  })
  .loose();
