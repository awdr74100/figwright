import { z } from 'zod';

// Shared Zod effect schema, reused by set_effects / create_effect_style so the shadow + blur shape
// can't drift between them (they previously copy-pasted the same inline JSON shape). Loose so an
// effect read back from get_node round-trips into a write. The plugin's toFigmaEffect enforces that
// shadows carry color + offset and blurs carry radius.

const rgba = z.object({ r: z.number(), g: z.number(), b: z.number(), a: z.number() });

/** One effect: DROP_SHADOW / INNER_SHADOW (color + offset) or LAYER_BLUR / BACKGROUND_BLUR (radius). */
export const effectItemSchema = z
  .object({
    type: z.enum(['DROP_SHADOW', 'INNER_SHADOW', 'LAYER_BLUR', 'BACKGROUND_BLUR']),
    visible: z.boolean(),
    radius: z.number().optional(),
    color: rgba.describe('Shadow color (RGBA 0–1). Required for shadows.').optional(),
    offset: z
      .object({ x: z.number(), y: z.number() })
      .describe('Shadow offset in px. Required for shadows.')
      .optional(),
    spread: z.number().optional(),
  })
  .loose();
