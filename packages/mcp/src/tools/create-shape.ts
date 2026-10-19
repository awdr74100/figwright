import { z } from 'zod';

import { initialStyleShape } from './initial-props-schema.js';
import type { ToolSpec } from './spec.js';

export const CREATE_SHAPE_TOOL_NAME = 'create_shape';

export const createShapeTool: ToolSpec = {
  name: CREATE_SHAPE_TOOL_NAME,
  description:
    'Create a LINE, POLYGON or STAR, optionally sized/positioned and appended to a parent ' +
    '(default: current page). A LINE is a length: `width` is its length (default 100, with the ' +
    'black 1px stroke Figma gives it) and it has no height — pass strokes / strokeWeight here to ' +
    'style it (caps via set_strokes) and tilt it with rotate_nodes. A POLYGON takes `pointCount` ' +
    '(sides, 3–60, default 3) and a STAR takes `pointCount` (points, 3–60, default 5) and `innerRadius` ' +
    '(the inner ring as a share of the outer, above 0 and up to 1 — 1 is a regular polygon of twice the points; default 0.38). For rectangles and ellipses ' +
    'use create_rectangle / create_ellipse; to cut or merge shapes use boolean_operation; for ' +
    'arbitrary vector artwork import_svg. fills, strokes and layoutSizing* style it in the same ' +
    'call. Returns { ok, nodeId, name, type }.',
  inputSchema: z.object({
    shape: z.enum(['LINE', 'POLYGON', 'STAR']).describe('Which shape to create'),
    parentId: z.string().optional().describe('Container node id; omit for current page'),
    name: z.string().optional().describe('Layer name'),
    x: z.number().optional().describe('X position in the parent'),
    y: z.number().optional().describe('Y position in the parent'),
    width: z.number().positive().optional().describe('Width in px (a LINE’s length)'),
    height: z
      .number()
      .positive()
      .optional()
      .describe('Height in px (POLYGON / STAR only; a LINE has none)'),
    // Figma caps both at 60 and draws 60 for anything larger without saying so (measured: 100
    // sides and 200 points both came back as 60), so a larger count is refused, not clamped.
    pointCount: z
      .number()
      .int()
      .min(3)
      .max(60)
      .optional()
      .describe('Sides of a POLYGON or points of a STAR, 3–60'),
    // 0 is a degenerate star with no area: Figma accepts it and draws nothing (measured).
    innerRadius: z
      .number()
      .gt(0)
      .max(1)
      .optional()
      .describe('STAR only: inner ring as a share of the outer radius, above 0 and up to 1'),
    ...initialStyleShape,
  }),
  kind: 'write',
};
