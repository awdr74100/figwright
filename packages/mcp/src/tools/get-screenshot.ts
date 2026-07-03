import { type GetScreenshotResult, SCREENSHOT_FORMATS } from '@figwright/shared';
import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const GET_SCREENSHOT_TOOL_NAME = 'get_screenshot';

export const getScreenshotTool: ToolSpec = {
  name: GET_SCREENSHOT_TOOL_NAME,
  description:
    'Export nodes as images the model can see, one image block per node: { images: [{ nodeId, format, ' +
    'base64, width?, height?, scale?, recovered?, empty? }] }. format is PNG (default) / JPG / SVG. ' +
    'scale applies to raster formats; when omitted, each node is auto-fitted to a legible size ' +
    '(long edge into ~512–1536px: oversized frames scale down, tiny icons scale up ≤4x) — pass an ' +
    'explicit scale to force one. Each raster label reports the exported width×height px and the ' +
    'scale, the anchor for mapping raster px back to design px. base64 is null for missing or ' +
    'non-exportable nodes. Nodes that are fully clipped or off-canvas (carousels, masks, off-screen ' +
    'states) are auto-recovered at their intrinsic bounds and flagged recovered:true. empty:true ' +
    'means the node genuinely renders nothing even unclipped (hidden / no content) so the export is blank.',
  inputShape: {
    nodeIds: z.array(z.string()).describe('Figma node ids to export'),
    format: z
      .enum(SCREENSHOT_FORMATS)
      .describe('Export format: PNG (default) / JPG / SVG')
      .optional(),
    scale: z
      .number()
      .positive()
      .describe('Raster scale factor (PNG/JPG); omit to auto-fit each node to a legible size')
      .optional(),
  },
  kind: 'read',
};
/** A subset of MCP tool-result content blocks this tool emits. */
export type ScreenshotContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

const RASTER_MIME: Partial<Record<string, string>> = { PNG: 'image/png', JPG: 'image/jpeg' };

/**
 * Turn a get_screenshot result into MCP content blocks so the model can actually _see_ raster
 * exports (PNG/JPG as image blocks) instead of receiving an opaque base64 string. SVG is returned
 * as readable markup text; missing/non-exportable nodes become a short text note.
 */
export const screenshotContent = (result: GetScreenshotResult): ScreenshotContent[] => {
  const blocks: ScreenshotContent[] = [];
  for (const img of result.images) {
    if (img.base64 === null) {
      blocks.push({ type: 'text', text: `${img.nodeId}: not exportable` });
      continue;
    }
    const emptyNote = img.empty
      ? ' — ⚠ empty (node renders nothing even unclipped: hidden / no content)'
      : img.recovered
        ? ' — ↺ recovered (clipped/off-canvas; rendered at intrinsic bounds)'
        : '';
    // Raster size + scale in the label anchors raster px ↔ design px (vital once the scale is
    // auto-fitted). Absent on SVG and on results from an older plugin build — degrade to the bare label.
    const dims =
      img.width !== undefined && img.height !== undefined
        ? ` ${img.width}×${img.height}px${img.scale !== undefined ? ` @${img.scale}x` : ''}`
        : '';
    const mimeType = RASTER_MIME[img.format];
    if (mimeType === undefined) {
      const markup = Buffer.from(img.base64, 'base64').toString('utf8');
      blocks.push({ type: 'text', text: `${img.nodeId} (${img.format})${emptyNote}:\n${markup}` });
    } else {
      blocks.push({ type: 'text', text: `${img.nodeId} (${img.format}${dims})${emptyNote}` });
      blocks.push({ type: 'image', data: img.base64, mimeType });
    }
  }
  if (blocks.length === 0) blocks.push({ type: 'text', text: 'No nodes exported.' });
  return blocks;
};
