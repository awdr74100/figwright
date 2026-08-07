import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type {
  ImageFillsResult,
  NodeImageFills,
  SaveImageFillsResult,
  SavedImageFill,
  SavedNodeImageFills,
} from '@figwright/shared';
import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SAVE_IMAGE_FILLS_TOOL_NAME = 'save_image_fills';

const inputSchema = z.object({
  nodeIds: z.array(z.string()).describe('Figma node ids whose IMAGE fills to extract'),
  outDir: z
    .string()
    .describe('Directory to write the original image files into (created if missing)'),
});

export const saveImageFillsTool: ToolSpec = {
  name: SAVE_IMAGE_FILLS_TOOL_NAME,
  description:
    "Extract the ORIGINAL image bytes behind each node's IMAGE fills and write them to disk under " +
    'outDir — the source asset exactly as uploaded (no mask, clip, crop, scale, or effects applied), ' +
    'unlike save_screenshots / get_screenshot which re-render the composited node. Returns ' +
    '{ nodes: [{ nodeId, images: [{ index, imageHash, format, path, width?, height?, scaleMode? }], ' +
    'mixed? }] }. index is the fill position in node.fills; width/height are the image intrinsic size; ' +
    'scaleMode is how the fill is displayed (FILL / FIT / CROP / TILE); format is sniffed from the ' +
    'bytes (PNG / JPG / GIF / WEBP, or BIN if unrecognized). Identical images (same imageHash reused ' +
    'across nodes) are fetched once and share one file named by hash. path is null when the fill image ' +
    "can't be resolved; images:[] means the node has no image fill; mixed:true means the node's fills " +
    'are per-text-range and were not enumerated. For a rendered/composited raster use save_screenshots; ' +
    'for a vector node use export_pdf.',
  inputSchema,
  kind: 'local',
};

/**
 * Sniff the container from the leading magic bytes so the file lands with the right extension. Only
 * the formats Figma stores as image fills are recognized; anything else is written verbatim as
 * `.bin` (lossless — the bytes are preserved, only the label is generic).
 */
export const detectImageFormat = (bytes: Buffer): { format: string; ext: string } => {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return { format: 'PNG', ext: 'png' };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { format: 'JPG', ext: 'jpg' };
  if (bytes.length >= 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46)
    return { format: 'GIF', ext: 'gif' };
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return { format: 'WEBP', ext: 'webp' };
  return { format: 'BIN', ext: 'bin' };
};

/** Map a Figma image hash to a filesystem-safe basename, blocking path traversal. */
const sanitize = (hash: string): string => hash.replace(/[^\w.-]/g, '-');

/** Carry the identifying/display fields through from the plugin result to the write result. */
const carry = (img: NodeImageFills['images'][number]): Omit<SavedImageFill, 'format' | 'path'> => ({
  index: img.index,
  imageHash: img.imageHash,
  ...(img.width !== undefined ? { width: img.width } : {}),
  ...(img.height !== undefined ? { height: img.height } : {}),
  ...(img.scaleMode !== undefined ? { scaleMode: img.scaleMode } : {}),
});

/**
 * Decode the base64 image bytes into files under outDir (created if missing). Files are named by
 * imageHash so an asset reused across many nodes is written exactly once; every usage still gets
 * its own result entry pointing at the shared path. Pure-fs and dispatch-free so it can be
 * unit-tested against a temp directory.
 */
export const writeImageFills = async (
  outDir: string,
  nodes: readonly NodeImageFills[],
): Promise<SaveImageFillsResult> => {
  const dir = resolve(outDir);
  await mkdir(dir, { recursive: true });

  // Dedup writes by path: a hash reused across nodes maps to one file written once. Build the whole
  // result (and the unique write set) first, then flush the files in parallel — no await in a loop.
  const toWrite = new Map<string, Buffer>();
  const outNodes: SavedNodeImageFills[] = nodes.map(node => {
    const images: SavedImageFill[] = node.images.map(img => {
      if (img.base64 === null || img.imageHash === null) return { ...carry(img), path: null };
      const buf = Buffer.from(img.base64, 'base64');
      const { format, ext } = detectImageFormat(buf);
      const path = join(dir, `${sanitize(img.imageHash)}.${ext}`);
      if (!toWrite.has(path)) toWrite.set(path, buf);
      return { ...carry(img), format, path };
    });
    return { nodeId: node.nodeId, images, ...(node.mixed === true ? { mixed: true } : {}) };
  });

  await Promise.all([...toWrite].map(([path, buf]) => writeFile(path, buf)));
  return { nodes: outNodes };
};

export type ToolDispatcher = (toolName: string, args: unknown) => Promise<unknown>;

/**
 * Reuses the plugin-side save_image_fills handler to fetch the original fill bytes, then lands them
 * on the server filesystem.
 */
export const handleSaveImageFills = async (
  dispatch: ToolDispatcher,
  rawArgs: unknown,
): Promise<SaveImageFillsResult> => {
  const args = inputSchema.parse(rawArgs);
  const { nodes } = (await dispatch(SAVE_IMAGE_FILLS_TOOL_NAME, {
    nodeIds: args.nodeIds,
  })) as ImageFillsResult;
  return writeImageFills(args.outDir, nodes);
};
