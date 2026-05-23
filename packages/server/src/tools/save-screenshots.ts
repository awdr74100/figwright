import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  type GetScreenshotResult,
  type SavedScreenshot,
  type SaveScreenshotsResult,
  SCREENSHOT_FORMATS,
  type ScreenshotImage,
} from '@figma-mcp-relay/shared';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as v from 'valibot';

import { GET_SCREENSHOT_TOOL_NAME } from './get-screenshot.js';

export const SAVE_SCREENSHOTS_TOOL_NAME = 'save_screenshots';

export const SaveScreenshotsInputSchema = v.object({
  nodeIds: v.array(v.string()),
  outDir: v.string(),
  format: v.optional(v.picklist(SCREENSHOT_FORMATS)),
  scale: v.optional(v.pipe(v.number(), v.minValue(0))),
});
export type SaveScreenshotsInput = v.InferOutput<typeof SaveScreenshotsInputSchema>;

export const saveScreenshotsToolDefinition: Tool = {
  name: SAVE_SCREENSHOTS_TOOL_NAME,
  description:
    'Export nodes and write them to disk under outDir: { saved: [{ nodeId, format, path }] }. ' +
    'format is PNG (default) / JPG / SVG; scale applies to raster formats (default 1). ' +
    'path is null for missing or non-exportable nodes. Files are named after a sanitized node id.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeIds: { type: 'array', items: { type: 'string' }, description: 'Figma node ids to export' },
      outDir: { type: 'string', description: 'Directory to write files into (created if missing)' },
      format: {
        type: 'string',
        enum: [...SCREENSHOT_FORMATS],
        description: 'Export format: PNG (default) / JPG / SVG',
      },
      scale: { type: 'number', minimum: 0, description: 'Raster scale factor (PNG/JPG), default 1' },
    },
    required: ['nodeIds', 'outDir'],
    additionalProperties: false,
  },
};

const EXTENSIONS: Record<string, string> = { PNG: 'png', JPG: 'jpg', SVG: 'svg' };

/** Map a Figma node id (e.g. "1:2") to a filesystem-safe basename, blocking path traversal. */
const sanitize = (id: string): string => id.replace(/[^\w.-]/g, '-');

/**
 * Decode the base64 images into files under outDir (created if missing).
 * Pure-fs and dispatch-free so it can be unit-tested against a temp directory.
 */
export const writeScreenshots = async (
  outDir: string,
  images: readonly ScreenshotImage[],
): Promise<SaveScreenshotsResult> => {
  const dir = resolve(outDir);
  await mkdir(dir, { recursive: true });

  const saved: SavedScreenshot[] = await Promise.all(
    images.map(async (img): Promise<SavedScreenshot> => {
      if (img.base64 === null) return { nodeId: img.nodeId, format: img.format, path: null };
      const ext = EXTENSIONS[img.format] ?? img.format.toLowerCase();
      const path = join(dir, `${sanitize(img.nodeId)}.${ext}`);
      await writeFile(path, Buffer.from(img.base64, 'base64'));
      return { nodeId: img.nodeId, format: img.format, path };
    }),
  );

  return { saved };
};

export type ToolDispatcher = (toolName: string, args: unknown) => Promise<unknown>;

/**
 * Reuses the plugin-side get_screenshot export (no dedicated plugin handler) to fetch
 * base64 bytes, then lands them on the server filesystem — the first server-side write tool.
 */
export const handleSaveScreenshots = async (
  dispatch: ToolDispatcher,
  rawArgs: unknown,
): Promise<SaveScreenshotsResult> => {
  const args = v.parse(SaveScreenshotsInputSchema, rawArgs);

  const screenshotArgs: Record<string, unknown> = { nodeIds: args.nodeIds };
  if (args.format !== undefined) screenshotArgs.format = args.format;
  if (args.scale !== undefined) screenshotArgs.scale = args.scale;

  const { images } = (await dispatch(GET_SCREENSHOT_TOOL_NAME, screenshotArgs)) as GetScreenshotResult;
  return writeScreenshots(args.outDir, images);
};
