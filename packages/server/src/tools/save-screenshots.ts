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

import { GET_SCREENSHOT_TOOL_NAME } from './get-screenshot.js';
import type { ToolSpec } from './spec.js';

export const SAVE_SCREENSHOTS_TOOL_NAME = 'save_screenshots';

const inputShape = {
  nodeIds: z.array(z.string()).describe('Figma node ids to export'),
  outDir: z.string().describe('Directory to write files into (created if missing)'),
  format: z
    .enum(SCREENSHOT_FORMATS)
    .describe('Export format: PNG (default) / JPG / SVG')
    .optional(),
  scale: z.number().min(0).describe('Raster scale factor (PNG/JPG), default 1').optional(),
};

export const saveScreenshotsTool: ToolSpec = {
  name: SAVE_SCREENSHOTS_TOOL_NAME,
  description:
    'Export nodes and write them to disk under outDir: { saved: [{ nodeId, format, path, empty? }] }. ' +
    'format is PNG (default) / JPG / SVG; scale applies to raster formats (default 1). ' +
    'path is null for missing or non-exportable nodes. empty:true means the node rendered nothing ' +
    '(hidden / no visible content / fully clipped or off-canvas) so the written file is blank — for an ' +
    'instance that should have art, re-export its main component. Files are named after a sanitized node id.',
  inputShape,
  kind: 'local',
};
const EXTENSIONS: Record<string, string> = { PNG: 'png', JPG: 'jpg', SVG: 'svg' };

/** Map a Figma node id (e.g. "1:2") to a filesystem-safe basename, blocking path traversal. */
const sanitize = (id: string): string => id.replace(/[^\w.-]/g, '-');

/**
 * Decode the base64 images into files under outDir (created if missing). Pure-fs and dispatch-free
 * so it can be unit-tested against a temp directory.
 */
export const writeScreenshots = async (
  outDir: string,
  images: readonly ScreenshotImage[],
): Promise<SaveScreenshotsResult> => {
  const dir = resolve(outDir);
  await mkdir(dir, { recursive: true });

  const saved: SavedScreenshot[] = await Promise.all(
    images.map(async (img): Promise<SavedScreenshot> => {
      const empty = img.empty === true ? { empty: true } : {};
      if (img.base64 === null)
        return { nodeId: img.nodeId, format: img.format, path: null, ...empty };
      const ext = EXTENSIONS[img.format] ?? img.format.toLowerCase();
      const path = join(dir, `${sanitize(img.nodeId)}.${ext}`);
      await writeFile(path, Buffer.from(img.base64, 'base64'));
      return { nodeId: img.nodeId, format: img.format, path, ...empty };
    }),
  );

  return { saved };
};

export type ToolDispatcher = (toolName: string, args: unknown) => Promise<unknown>;

/**
 * Reuses the plugin-side get_screenshot export (no dedicated plugin handler) to fetch base64 bytes,
 * then lands them on the server filesystem — the first server-side write tool.
 */
export const handleSaveScreenshots = async (
  dispatch: ToolDispatcher,
  rawArgs: unknown,
): Promise<SaveScreenshotsResult> => {
  const args = z.object(inputShape).parse(rawArgs);

  const screenshotArgs: Record<string, unknown> = { nodeIds: args.nodeIds };
  if (args.format !== undefined) screenshotArgs.format = args.format;
  if (args.scale !== undefined) screenshotArgs.scale = args.scale;

  const { images } = (await dispatch(
    GET_SCREENSHOT_TOOL_NAME,
    screenshotArgs,
  )) as GetScreenshotResult;
  return writeScreenshots(args.outDir, images);
};
