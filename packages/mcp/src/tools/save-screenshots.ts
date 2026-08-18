import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  type GetScreenshotResult,
  type SavedScreenshot,
  type SaveScreenshotsResult,
  SCREENSHOT_FORMATS,
  type ScreenshotImage,
} from '@figwright/shared';
import { z } from 'zod';

import { BINARY_REQUEST, binaryPayload } from './binary-payload.js';
import { GET_SCREENSHOT_TOOL_NAME } from './get-screenshot.js';
import type { ToolSpec } from './spec.js';

export const SAVE_SCREENSHOTS_TOOL_NAME = 'save_screenshots';

const inputSchema = z.object({
  nodeIds: z.array(z.string()).describe('Figma node ids to export'),
  outDir: z.string().describe('Directory to write files into (created if missing)'),
  format: z
    .enum(SCREENSHOT_FORMATS)
    .describe('Export format: PNG (default) / JPG / SVG')
    .optional(),
  scale: z.number().positive().describe('Raster scale factor (PNG/JPG), default 1').optional(),
});

export const saveScreenshotsTool: ToolSpec = {
  name: SAVE_SCREENSHOTS_TOOL_NAME,
  description:
    'Export nodes and write them to disk under outDir: { saved: [{ nodeId, format, path, recovered?, empty? }] }. ' +
    'format is PNG (default) / JPG / SVG; scale applies to raster formats (default 1). ' +
    'path is null for missing or non-exportable nodes. Nodes that are fully clipped or off-canvas ' +
    "(e.g. a carousel's edge items) are auto-recovered at their intrinsic bounds and flagged recovered:true. " +
    'empty:true means the node genuinely renders nothing even unclipped (hidden / no content) so the file is blank. ' +
    'Files are named after a sanitized node id.',
  inputSchema,
  kind: 'local',
};
const EXTENSIONS: Record<string, string> = { PNG: 'png', JPG: 'jpg', SVG: 'svg' };

/** Map a Figma node id (e.g. "1:2") to a filesystem-safe basename, blocking path traversal. */
const sanitize = (id: string): string => id.replace(/[^\w.-]/g, '-');

/**
 * Land the exported images as files under outDir (created if missing). Pure-fs and dispatch-free so
 * it can be unit-tested against a temp directory.
 */
export const writeScreenshots = async (
  outDir: string,
  images: readonly ScreenshotImage[],
): Promise<SaveScreenshotsResult> => {
  const dir = resolve(outDir);
  await mkdir(dir, { recursive: true });

  const saved: SavedScreenshot[] = await Promise.all(
    images.map(async (img): Promise<SavedScreenshot> => {
      const flags = {
        ...(img.empty === true ? { empty: true as const } : {}),
        ...(img.recovered === true ? { recovered: true as const } : {}),
      };
      const payload = binaryPayload(img);
      if (payload === null) return { nodeId: img.nodeId, format: img.format, path: null, ...flags };
      const ext = EXTENSIONS[img.format] ?? img.format.toLowerCase();
      const path = join(dir, `${sanitize(img.nodeId)}.${ext}`);
      await writeFile(path, payload);
      return { nodeId: img.nodeId, format: img.format, path, ...flags };
    }),
  );

  return { saved };
};

export type ToolDispatcher = (toolName: string, args: unknown) => Promise<unknown>;

/**
 * Reuses the plugin-side get_screenshot export (no dedicated plugin handler) to fetch the raster
 * bytes, then lands them on the server filesystem — the first server-side write tool.
 */
export const handleSaveScreenshots = async (
  dispatch: ToolDispatcher,
  rawArgs: unknown,
): Promise<SaveScreenshotsResult> => {
  const args = inputSchema.parse(rawArgs);

  const screenshotArgs: Record<string, unknown> = { ...BINARY_REQUEST, nodeIds: args.nodeIds };
  if (args.format !== undefined) screenshotArgs.format = args.format;
  // Always pass an explicit scale: an omitted scale makes get_screenshot auto-fit the raster for
  // model consumption, but files written to disk are user artifacts and must stay full-res.
  screenshotArgs.scale = args.scale ?? 1;

  const { images } = (await dispatch(
    GET_SCREENSHOT_TOOL_NAME,
    screenshotArgs,
  )) as GetScreenshotResult;
  return writeScreenshots(args.outDir, images);
};
