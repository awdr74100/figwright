import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const CREATE_GRID_STYLE_TOOL_NAME = 'create_grid_style';

export const createGridStyleTool: ToolSpec = {
  name: CREATE_GRID_STYLE_TOOL_NAME,
  description:
    'Create a reusable local layout-grid style for aligning content. Each grid pattern is GRID ' +
    '(uniform squares via sectionSize) or ROWS / COLUMNS (count + gutterSize + alignment). Apply it ' +
    'to frames with apply_style_to_node. Returns { ok, styleId, name }.',
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
