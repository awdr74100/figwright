import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const IMPORT_SVG_TOOL_NAME = 'import_svg';

export const importSvgTool: ToolSpec = {
  name: IMPORT_SVG_TOOL_NAME,
  description:
    'Import an SVG and place it as editable vector nodes (a FRAME of VECTOR paths) via ' +
    "createNodeFromSvg — use this for vector logos, brand marks, and icons. Provide the SVG's raw " +
    'markup string (read it from the project asset, or inline it). The frame defaults to the SVG ' +
    'intrinsic size unless width/height are given. For raster photos (PNG / JPG) use import_image ' +
    'instead; when a matching icon component already exists, create_instance it rather than re-pasting ' +
    'the SVG. Returns { ok, nodeId, name, type }.',
  inputShape: {
    svg: z.string().describe('Raw SVG markup, e.g. "<svg …>…</svg>"'),
    name: z.string().optional().describe('Optional name for the new node'),
    parentId: z.string().optional().describe('Parent node id (default: current page)'),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional().describe('Override width (default: SVG intrinsic width)'),
    height: z.number().optional().describe('Override height (default: SVG intrinsic height)'),
  },
  kind: 'write',
};
