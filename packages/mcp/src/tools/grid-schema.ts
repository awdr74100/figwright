import { z } from 'zod';

import { boundVariablesSchema } from './binding-schema.js';
import { colorSpaceSchema } from './color-space-schema.js';

// Shared Zod layout-grid schema, reused by set_layout_grids / create_grid_style so the shape can't
// drift between them (they previously carried the same inline object twice, and the copies had
// already diverged in their descriptions). Loose, like the paint and effect schemas, so a grid read
// back from get_node round-trips into a write. The plugin's toFigmaLayoutGrid enforces the rest
// (GRID needs sectionSize; ROWS/COLUMNS need count + gutterSize; CENTER rejects offset).

/** One layout grid: GRID (uniform squares) or ROWS / COLUMNS (count + gutter + alignment). */
export const gridItemSchema = z
  .object({
    pattern: z.enum(['GRID', 'ROWS', 'COLUMNS']),
    visible: z.boolean(),
    sectionSize: z
      .number()
      .optional()
      .describe('Cell size for GRID; section size for ROWS/COLUMNS (ignored when STRETCH)'),
    count: z.number().optional().describe('Number of columns/rows (ROWS/COLUMNS)'),
    gutterSize: z.number().optional().describe('Gap between columns/rows (ROWS/COLUMNS)'),
    alignment: z.enum(['MIN', 'MAX', 'CENTER', 'STRETCH']).optional(),
    offset: z.number().optional().describe('Page margin from the frame edge (ignored when CENTER)'),
    // Alpha optional and no range here on purpose: a colour Figma would refuse is left out by the
    // plugin and reported in `adjusted`, so it never fails the grids that came with it.
    color: z
      .object({
        r: z.number(),
        g: z.number(),
        b: z.number(),
        a: z.number().optional(),
        space: colorSpaceSchema.optional(),
      })
      .optional()
      .describe(
        "The grid's colour in the editor — r/g/b/a, each 0–1, alpha required — as get_node " +
          "reports it; omit for Figma's default, red at 10%. One Figma would refuse is left out " +
          '(the grid gets the default) and named in adjusted',
      ),
    boundVariables: boundVariablesSchema
      .describe('Bindable fields: sectionSize / count / offset / gutterSize (FLOAT variables).')
      .optional(),
  })
  .loose();
