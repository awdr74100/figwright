import { z } from 'zod';

/**
 * The documentation link a component, component set or style carries — shared by every tool that
 * writes one, so the shape and its limit read the same everywhere. Figma keeps at most one link and
 * refuses more; a uri with no scheme, a leading space or nothing at all is refused too
 * ("Documentation link must be a URL"), while any scheme passes (all measured).
 */
export const documentationLinksSchema = z
  .array(
    z.object({
      uri: z.string().describe('A URL with its scheme, e.g. "https://storybook.example.com/…"'),
    }),
  )
  .max(1);

/** Described where it is used, after `.optional()`, so the advertised schema keeps its key order. */
export const DOCUMENTATION_LINKS_DESCRIPTION =
  "The documentation link — at most one (Figma's limit); [] removes it";
