import { z } from 'zod';

import { boundVariablesSchema } from './binding-schema.js';

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
    boundVariables: boundVariablesSchema
      .describe('Bindable fields: sectionSize / count / offset / gutterSize (FLOAT variables).')
      .optional(),
  })
  .loose();
