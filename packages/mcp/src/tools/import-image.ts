import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const IMPORT_IMAGE_TOOL_NAME = 'import_image';

export const importImageTool: ToolSpec = {
  name: IMPORT_IMAGE_TOOL_NAME,
  description:
    'Import a raster image (PNG / JPG / GIF) and place it as a rectangle with an IMAGE fill. Provide ' +
    'data (base64-encoded image bytes) or url. The rectangle defaults to the image size unless ' +
    'width/height are given. scaleMode is FILL / FIT / CROP / TILE (default FILL). For vector SVG ' +
    '(logos / icons) use import_svg instead. Returns { ok, nodeId, name, type }.',
  inputShape: {
    data: z.string().optional().describe('Base64-encoded image bytes (PNG / JPG / GIF)'),
    url: z.string().optional().describe('Image URL to fetch instead of data'),
    name: z.string().optional().describe('Optional name for the new rectangle'),
    parentId: z.string().optional().describe('Parent node id (default: current page)'),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional().describe('Override width (default: image width)'),
    height: z.number().optional().describe('Override height (default: image height)'),
    scaleMode: z.enum(['FILL', 'FIT', 'CROP', 'TILE']).optional(),
  },
  kind: 'write',
};
