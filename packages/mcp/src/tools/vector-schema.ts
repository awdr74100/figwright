import { z } from 'zod';

import { paintItemSchema } from './paint-schema.js';

// A vector's geometry in Figma's two shapes, shared by create_vector and set_vector and in the
// form get_vector reads it back, so a read feeds straight into a write.

const point = z.object({ x: z.number(), y: z.number() });

/** SVG path data per subpath — the simple way to draw: `M 0 0 C 40 -20 80 20 120 0`. */
export const vectorPathsSchema = z
  .array(
    z.object({
      windingRule: z
        .enum(['NONZERO', 'EVENODD', 'NONE'])
        .describe(
          'How the path fills: NONZERO / EVENODD for a closed shape, NONE for an open line',
        ),
      data: z
        .string()
        .min(1)
        .describe(
          'SVG path data in any syntax — relative commands, H / V, S / T, arcs and minified icon paths ' +
            'included; it is rewritten into the absolute M / L / C / Q / Z form Figma stores',
        ),
    }),
  )
  .min(1)
  .describe(
    'Path data with its winding rule; one entry may hold several subpaths (each M starts one)',
  );

/** Figma's vector network: vertices joined by segments, with fillable regions. */
export const vectorNetworkSchema = z
  .object({
    vertices: z
      .array(
        z.object({
          x: z.number(),
          y: z.number(),
          strokeCap: z
            .enum([
              'NONE',
              'ROUND',
              'SQUARE',
              'ARROW_LINES',
              'ARROW_EQUILATERAL',
              'DIAMOND_FILLED',
              'TRIANGLE_FILLED',
              'CIRCLE_FILLED',
            ])
            .describe('The end cap drawn at this vertex when it ends an open path (an arrowhead)')
            .optional(),
          strokeJoin: z.enum(['MITER', 'BEVEL', 'ROUND']).optional(),
          cornerRadius: z.number().min(0).describe('Rounds the corner at this vertex').optional(),
          handleMirroring: z.enum(['NONE', 'ANGLE', 'ANGLE_AND_LENGTH']).optional(),
        }),
      )
      .min(1),
    segments: z.array(
      z.object({
        start: z.number().int().min(0).describe('Index of the vertex it starts at'),
        end: z.number().int().min(0).describe('Index of the vertex it ends at'),
        tangentStart: point
          .describe('Bézier handle at the start, relative to that vertex ({0,0} = straight)')
          .optional(),
        tangentEnd: point.describe('Bézier handle at the end, relative to that vertex').optional(),
      }),
    ),
    regions: z
      .array(
        z.object({
          windingRule: z.enum(['NONZERO', 'EVENODD']),
          loops: z
            .array(z.array(z.number().int().min(0)))
            .describe('Each loop lists the segment indices that close it, in order'),
          fills: z
            .array(paintItemSchema)
            .describe('This region’s own fills (otherwise the node’s fills apply)')
            .optional(),
        }),
      )
      .describe('Closed areas that take a fill; omit for a stroke-only drawing')
      .optional(),
  })
  .describe(
    'Vertices joined by segments — unlike SVG paths, a vertex may join three or more segments (a ' +
      'branching drawing). Each segment may curve through Bézier tangents.',
  );
