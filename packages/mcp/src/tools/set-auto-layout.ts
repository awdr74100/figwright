import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_AUTO_LAYOUT_TOOL_NAME = 'set_auto_layout';

export const setAutoLayoutTool: ToolSpec = {
  name: SET_AUTO_LAYOUT_TOOL_NAME,
  description:
    "Configure a frame's auto layout. layoutMode NONE disables it; HORIZONTAL/VERTICAL enable flex " +
    '(padding / itemSpacing / alignment / wrap, plus counterAxisSpacing / counterAxisAlignContent ' +
    'for the wrapped cross axis — the CSS row-gap / align-content — and itemReverseZIndex / ' +
    'strokesIncludedInLayout for paint order and stroke-in-layout); GRID enables CSS-Grid-style ' +
    'layout (padding / gridRowCount / gridColumnCount / gridRowGap / gridColumnGap). ' +
    'Returns { ok, nodeId }.',
  inputShape: {
    nodeId: z.string(),
    layoutMode: z.enum(['NONE', 'HORIZONTAL', 'VERTICAL', 'GRID']),
    paddingTop: z.number().optional(),
    paddingRight: z.number().optional(),
    paddingBottom: z.number().optional(),
    paddingLeft: z.number().optional(),
    // HORIZONTAL / VERTICAL
    itemSpacing: z.number().optional(),
    primaryAxisAlignItems: z.enum(['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN']).optional(),
    counterAxisAlignItems: z.enum(['MIN', 'CENTER', 'MAX', 'BASELINE']).optional(),
    layoutWrap: z.enum(['NO_WRAP', 'WRAP']).optional(),
    counterAxisSpacing: z
      .number()
      .min(0)
      .optional()
      .describe(
        'Cross-axis gap between wrapped rows (px) — the CSS row-gap when it differs from ' +
          'itemSpacing (gap: 16px 8px). Requires layoutWrap WRAP (settable in the same call)',
      ),
    counterAxisAlignContent: z
      .enum(['AUTO', 'SPACE_BETWEEN'])
      .optional()
      .describe(
        'How wrapped rows distribute along the cross axis: AUTO packs them at counterAxisSpacing, ' +
          'SPACE_BETWEEN spreads them (align-content). Requires layoutWrap WRAP',
      ),
    itemReverseZIndex: z
      .boolean()
      .optional()
      .describe(
        'Paint later siblings UNDER earlier ones (reversed canvas order) — the stacked-avatars / ' +
          'overlapping-cards pattern, usually with negative itemSpacing. HORIZONTAL/VERTICAL only',
      ),
    strokesIncludedInLayout: z
      .boolean()
      .optional()
      .describe(
        'Make strokes take up layout space (gaps/padding grow by the stroke weight); Figma ' +
          'defaults to excluding them. HORIZONTAL/VERTICAL only',
      ),
    // GRID
    gridRowCount: z.number().int().positive().optional(),
    gridColumnCount: z.number().int().positive().optional(),
    gridRowGap: z.number().optional(),
    gridColumnGap: z.number().optional(),
  },
  kind: 'write',
};
