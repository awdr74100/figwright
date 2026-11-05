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
    'autoLayout, a width or height you pass stays FIXED on its axis unless the layoutSizing* ' +
    'of that axis says otherwise (Figma would otherwise hug it) — a width alone fixes the width ' +
    'and lets the height hug; omit a side, or pass HUG, to hug the content. For a ' +
    'canvas-level grouping container use create_section instead. Returns { ok, nodeId, name, type }.',
  inputSchema: z.object({
    parentId: z
      .string()
      .optional()
      .describe('Container node id to append into; omit for current page'),
    name: z.string().optional().describe('Frame name'),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z
      .number()
      .min(0.01)
      .optional()
      .describe('Frame width in px, at least 0.01; alone, the height stays at 100'),
    height: z
      .number()
      .min(0.01)
      .optional()
      .describe('Frame height in px, at least 0.01; alone, the width stays at 100'),
    ...initialStyleShape,
    ...initialRadiusShape,
    ...initialFrameShape,
  }),
  kind: 'write',
};
