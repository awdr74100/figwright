import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  type GetScreenshotResult,
  type SavedScreenshot,
  type SaveScreenshotsResult,
  SCREENSHOT_FORMATS,
  type ScreenshotFormat,
  type ScreenshotImage,
} from '@figwright/shared';
import { z } from 'zod';

import { binaryPayload } from './binary-payload.js';
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
  // No sandbox handler of its own; its plugin arguments are recorded under the tool it reuses.
  serverOnlyArgs: null,
};
/**
 * The extension written for each format. Keyed by `SCREENSHOT_FORMATS` — a new export format is
 * added to both. Typed by `ScreenshotFormat` so a format missing here fails to compile.
 */
const EXTENSIONS: Readonly<Record<ScreenshotFormat, string>> = {
  PNG: 'png',
  JPG: 'jpg',
  SVG: 'svg',
};

/** Map a Figma node id (e.g. "1:2") to a filesystem-safe basename, blocking path traversal. */
const sanitize = (id: string): string => id.replace(/[^\w.-]/g, '-');

/** What the caller asked get_screenshot for — the only source a written file's name is taken from. */
export interface ScreenshotRequest {
  nodeIds: readonly string[];
  format: ScreenshotFormat;
}

/**
 * Land the exported images as files under outDir (created if missing). Pure-fs and dispatch-free so
 * it can be unit-tested against a temp directory.
 *
 * A file's name and extension come from the request, never from the reply. The reply is cast, not
 * re-parsed on the wire, so its `nodeId` and `format` are untrusted: taken at face value they let a
 * reply choose which file in outDir to write — overwriting one nobody asked for — or write a
 * different type than was requested, and before this an unrecognised `format` was used as the
 * extension verbatim, separators and all. So an image is written only when it answers the request:
 * its `nodeId` is one that was asked for, and its `format` is the one that was asked for. Every
 * real export does — get_screenshot returns one image per requested id, carrying that id and the
 * requested format, in every plugin build — and anything else is reported non-exportable (path:
 * null), the shape a missing node already has.
 */
export const writeScreenshots = async (
  outDir: string,
  images: readonly ScreenshotImage[],
  request: ScreenshotRequest,
): Promise<SaveScreenshotsResult> => {
  const dir = resolve(outDir);
  await mkdir(dir, { recursive: true });
  // A Set, so membership answers only for ids that were asked for — an inherited name such as
  // `__proto__` is not a member, where a plain-object lookup would have answered for it.
  const requested = new Set(request.nodeIds);
  const ext = EXTENSIONS[request.format];

  const saved: SavedScreenshot[] = await Promise.all(
    images.map(async (img): Promise<SavedScreenshot> => {
      const flags = {
        ...(img.empty === true ? { empty: true as const } : {}),
        ...(img.recovered === true ? { recovered: true as const } : {}),
      };
      const payload = binaryPayload(img);
      const answersRequest = requested.has(img.nodeId) && img.format === request.format;
      if (payload === null || !answersRequest) {
        return { nodeId: img.nodeId, format: img.format, path: null, ...flags };
      }
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

  // Always an explicit format, even the default: the files are named from this request, so what was
  // asked for must not depend on the plugin's own default agreeing with ours. Every plugin build
  // treats an explicit PNG exactly as an omitted one.
  const request: ScreenshotRequest = { nodeIds: args.nodeIds, format: args.format ?? 'PNG' };
  const screenshotArgs: Record<string, unknown> = {
    nodeIds: request.nodeIds,
    format: request.format,
  };
  // These bytes go to disk, never to a model, so they ride the wire as a msgpack `bin`.
  screenshotArgs.binary = true;
  // Always pass an explicit scale: an omitted scale makes get_screenshot auto-fit the raster for
  // model consumption, but files written to disk are user artifacts and must stay full-res.
  screenshotArgs.scale = args.scale ?? 1;

  const { images } = (await dispatch(
    GET_SCREENSHOT_TOOL_NAME,
    screenshotArgs,
  )) as GetScreenshotResult;
  return writeScreenshots(args.outDir, images, request);
};
