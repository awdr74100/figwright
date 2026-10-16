import { z } from 'zod';

/**
 * The colour space a written colour's channels are in, shared by every colour a write tool takes
 * (paints, gradient stops, shadows, COLOR variable values) so the rule reads the same everywhere.
 *
 * Figma stores a colour in the document's own colour space — a Display P3 file holds P3 channels,
 * and reads report them that way — so a colour with no `space` is taken as document channels, and
 * anything read writes straight back unchanged. A colour taken from code is sRGB: written raw into
 * a P3 file it paints a visibly more saturated colour than the code renders, so it names "SRGB" and
 * the plugin has Figma convert it. In an sRGB file, "SRGB" changes nothing.
 */
export const colorSpaceSchema = z
  .enum(['SRGB', 'DISPLAY_P3'])
  .describe(
    "The space r/g/b are in. Omit for the document's own space, which is what reads report, so a " +
      'colour read from Figma writes back unchanged. A colour from code (CSS hex / rgb(), a design ' +
      'token) is sRGB: pass "SRGB" so a Display P3 file shows the same colour as the code instead ' +
      'of a more saturated one.',
  );
