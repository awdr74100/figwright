import { z } from 'zod';

import { fillPaintItemSchema } from './paint-schema.js';
import { setAutoLayoutTool } from './set-auto-layout.js';
import { setTextPropertiesTool } from './set-text-properties.js';

/**
 * What a create_* tool may set on the node it makes, so a styled element is one call instead of a
 * create followed by set_fills, set_strokes, set_corner_radius, set_layout_props…. Each field means
 * exactly what it means on the tool that sets it afterwards, and is applied by that tool's own
 * handler, so the two cannot drift. Everything here is optional; omit it all and the create behaves
 * as it always has.
 */
export const initialStyleShape = {
  fills: z
    .array(fillPaintItemSchema)
    .optional()
    .describe('Fills to apply on creation (as set_fills)'),
  strokes: z
    .array(fillPaintItemSchema)
    .optional()
    .describe('Stroke paints to apply on creation (as set_strokes)'),
  strokeWeight: z.number().min(0).optional().describe('Uniform stroke thickness in px'),
  strokeAlign: z
    .enum(['INSIDE', 'OUTSIDE', 'CENTER'])
    .optional()
    .describe('Stroke position relative to the geometry'),
  layoutSizingHorizontal: z
    .enum(['FIXED', 'HUG', 'FILL'])
    .optional()
    .describe('Horizontal sizing (as set_layout_props); FILL needs an auto-layout parent'),
  layoutSizingVertical: z
    .enum(['FIXED', 'HUG', 'FILL'])
    .optional()
    .describe('Vertical sizing (as set_layout_props); FILL needs an auto-layout parent'),
};

/** Corner radius for a node that has one (frame, rectangle). */
export const initialRadiusShape = {
  cornerRadius: z.number().min(0).optional().describe('Uniform corner radius in px'),
};

/** A frame's auto layout and clipping, in the same call that creates it. */
export const initialFrameShape = {
  autoLayout: setAutoLayoutTool.inputSchema
    .omit({ nodeId: true })
    .optional()
    .describe(
      'Auto layout to enable on creation — the same fields as set_auto_layout (layoutMode, ' +
        'padding*, itemSpacing, primaryAxisAlignItems, counterAxisAlignItems, …)',
    ),
  clipsContent: z.boolean().optional().describe('Clip children to the frame bounds'),
};

/** Typography for a new text node: the same fields as set_text_properties. */
export const initialTextShape = setTextPropertiesTool.inputSchema.omit({ nodeId: true }).shape;
