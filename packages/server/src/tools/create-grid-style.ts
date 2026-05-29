import { z } from 'zod';

import { specToToolDefinition, type ToolSpec } from './spec.js';

export const CREATE_GRID_STYLE_TOOL_NAME = 'create_grid_style';

export const createGridStyleTool: ToolSpec = {
  name: CREATE_GRID_STYLE_TOOL_NAME,
  description:
    'Create a local layout-grid style. GRID is uniform (sectionSize); ROWS / COLUMNS carry ' +
    'count + gutterSize + alignment. Returns { ok, styleId, name }.',
  inputShape: {
    name: z.string().describe('Style name, e.g. "Layout/8pt"'),
    grids: z.array(
      z.object({
        pattern: z.enum(['GRID', 'ROWS', 'COLUMNS']),
        visible: z.boolean(),
        sectionSize: z.number().optional(),
        count: z.number().optional(),
        gutterSize: z.number().optional(),
        alignment: z.enum(['MIN', 'MAX', 'CENTER', 'STRETCH']).optional(),
      }),
    ),
    description: z.string().optional(),
  },
  kind: 'write',
};

export const createGridStyleToolDefinition = specToToolDefinition(createGridStyleTool);
