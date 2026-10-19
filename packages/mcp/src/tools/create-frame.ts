import { z } from 'zod';

import {
  initialFrameShape,
  initialRadiusShape,
  initialStyleShape,
} from './initial-props-schema.js';
import type { ToolSpec } from './spec.js';

export const CREATE_FRAME_TOOL_NAME = 'create_frame';

export const createFrameTool: ToolSpec = {
  name: CREATE_FRAME_TOOL_NAME,
  description:
    'Create a frame — the primary container for UI and the only node that hosts auto-layout — ' +
    'optionally sized/positioned and appended to a parent (default: current page). Pass ' +
    'fills, strokes, cornerRadius, autoLayout and layoutSizing* to style and lay it out in this ' +
    'same call (each means what it does on its set_* tool) instead of a chain of follow-ups. With ' +
    'autoLayout, a width + height you pass stays FIXED on any axis whose layoutSizing* you omit ' +
    '(Figma would otherwise hug it); omit the size, or pass HUG, to hug the content. For a ' +
    'canvas-level grouping container use create_section instead. Returns { ok, nodeId, name, type }.',
  inputSchema: z.object({
    parentId: z
      .string()
      .optional()
      .describe('Container node id to append into; omit for current page'),
    name: z.string().optional().describe('Frame name'),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional().describe('Frame width (with height, resizes from default)'),
    height: z.number().optional().describe('Frame height (with width, resizes from default)'),
    ...initialStyleShape,
    ...initialRadiusShape,
    ...initialFrameShape,
  }),
  kind: 'write',
};
