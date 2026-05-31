import { type GetScreenshotResult, SCREENSHOT_FORMATS } from '@figma-mcp-relay/shared';
import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const GET_SCREENSHOT_TOOL_NAME = 'get_screenshot';

export const getScreenshotTool: ToolSpec = {
  name: GET_SCREENSHOT_TOOL_NAME,
  description:
    'Export nodes as base64 images: { images: [{ nodeId, format, base64 }] }. format is PNG (default) ' +
    '/ JPG / SVG; scale applies to raster formats (default 1). base64 is null for missing or ' +
    'non-exportable nodes.',
  inputShape: {
    nodeIds: z.array(z.string()).describe('Figma node ids to export'),
    format: z
      .enum(SCREENSHOT_FORMATS)
      .describe('Export format: PNG (default) / JPG / SVG')
      .optional(),
    scale: z.number().min(0).describe('Raster scale factor (PNG/JPG), default 1').optional(),
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
    const mimeType = RASTER_MIME[img.format];
    if (mimeType === undefined) {
      const markup = Buffer.from(img.base64, 'base64').toString('utf8');
      blocks.push({ type: 'text', text: `${img.nodeId} (${img.format}):\n${markup}` });
    } else {
      blocks.push({ type: 'text', text: `${img.nodeId} (${img.format})` });
      blocks.push({ type: 'image', data: img.base64, mimeType });
    }
  }
  if (blocks.length === 0) blocks.push({ type: 'text', text: 'No nodes exported.' });
  return blocks;
};
