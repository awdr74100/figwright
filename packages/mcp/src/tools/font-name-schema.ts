import { z } from 'zod';

/**
 * A font to write. Shared by every tool that assigns one (set_text_properties, set_text_range,
 * create_text_style, update_text_style) so the write side round-trips exactly what the read side
 * reports, `variationSettings` included.
 *
 * `style` is optional because Figma resolves the named instance closest to `variationSettings` when
 * it is omitted — which is what an agent holding a CSS `font-weight: 900` can actually express,
 * having no way to know the family calls that instance "Black".
 */
export const fontNameSchema = z
  .object({
    family: z.string().describe('Font family, e.g. "Inter"'),
    style: z
      .string()
      .optional()
      .describe(
        'Named instance, e.g. "Bold". Omit to let Figma pick the one closest to variationSettings',
      ),
    variationSettings: z
      .record(z.string(), z.number())
      .optional()
      .describe(
        'Variable-font axis values by OpenType tag, e.g. { "wght": 650, "slnt": -5 } — the same ' +
          'shape as CSS font-variation-settings. Only for a variable family; get_fonts reports ' +
          'which tags each family accepts under variationAxes, and setting a tag the family does ' +
          'not define throws. An omitted axis keeps the named instance default.',
      ),
  })
  .describe('Font: { family, style?, variationSettings? }');
