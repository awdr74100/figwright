import { z } from 'zod';

import {
  DOCUMENTATION_LINKS_DESCRIPTION,
  documentationLinksSchema,
} from './documentation-schema.js';
import { gridItemSchema } from './grid-schema.js';
import type { ToolSpec } from './spec.js';

export const UPDATE_GRID_STYLE_TOOL_NAME = 'update_grid_style';

export const updateGridStyleTool: ToolSpec = {
  name: UPDATE_GRID_STYLE_TOOL_NAME,
  description:
    'Update an existing layout-grid style by id, in place — frames using it follow, and its id ' +
    'stays, so they stay linked (deleting and recreating it would detach every one). Any of name / ' +
    'grids / description / documentationLinks may be omitted to leave unchanged; grids, when ' +
    "given, replaces the whole list — send each grid's color as get_styles reports it to keep it. " +
    'A grid written back WITHOUT its boundVariables clears the variables it was bound to. A call ' +
    'that fails part-way leaves the style as it was. Returns { ok, styleId, name, adjusted? } — ' +
    'adjusted names a grid color Figma would refuse (left out, so the grid gets the default) or a ' +
    'documentation link stored differently from what was sent.',
  inputSchema: z.object({
    styleId: z.string().describe('Grid style id to update'),
    name: z.string().optional(),
    grids: z.array(gridItemSchema).optional().describe('New grids (replaces all)'),
    description: z.string().optional(),
    documentationLinks: documentationLinksSchema
      .optional()
      .describe(DOCUMENTATION_LINKS_DESCRIPTION),
  }),
  kind: 'write',
};
