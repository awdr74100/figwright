import { z } from 'zod';

import {
  DOCUMENTATION_LINKS_DESCRIPTION,
  documentationLinksSchema,
} from './documentation-schema.js';
import { gridItemSchema } from './grid-schema.js';
import type { ToolSpec } from './spec.js';

export const CREATE_GRID_STYLE_TOOL_NAME = 'create_grid_style';

export const createGridStyleTool: ToolSpec = {
  name: CREATE_GRID_STYLE_TOOL_NAME,
  description:
    'Create a reusable local layout-grid style for aligning content. Each grid pattern is GRID ' +
    '(uniform squares via sectionSize) or ROWS / COLUMNS (count + gutterSize + alignment). Apply it ' +
    'to frames with apply_style_to_node, or edit it later with update_grid_style. Optionally with ' +
    'a documentation link. Returns { ok, styleId, name, adjusted? } — adjusted names a grid color ' +
    'Figma would refuse (left out, so the style is still created) or a documentation link stored ' +
    'differently from what was sent.',
  inputSchema: z.object({
    name: z.string().describe('Style name, e.g. "Layout/8pt"'),
    grids: z.array(gridItemSchema),
    description: z.string().optional(),
    documentationLinks: documentationLinksSchema
      .optional()
      .describe(DOCUMENTATION_LINKS_DESCRIPTION),
  }),
  kind: 'write',
};
