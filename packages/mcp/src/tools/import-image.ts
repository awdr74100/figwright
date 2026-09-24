import { open, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const IMPORT_IMAGE_TOOL_NAME = 'import_image';

export const importImageTool: ToolSpec = {
  name: IMPORT_IMAGE_TOOL_NAME,
  description:
    'Import a raster image (PNG / JPG / GIF) and place it as a rectangle with an IMAGE fill. Provide ' +
    'exactly one of path (a local file the server reads), data (base64-encoded image bytes) or url. ' +
    'Prefer path for a file on this machine: the bytes never pass through the conversation, and a ' +
    'large base64 data argument can exceed the transport message limit. url is fetched by Figma, not ' +
    'by this machine, so it must be publicly reachable. Figma accepts at most 4096px in width and ' +
    'height whichever source is used, so downscale a camera-resolution photo before importing it. ' +
    'The rectangle defaults to the image size unless width/height are given. scaleMode is ' +
    'FILL / FIT / CROP / TILE (default FILL). For vector SVG (logos / icons) use import_svg instead. ' +
    'Returns { ok, nodeId, name, type }.',
  inputSchema: z.object({
    path: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Local image file to import (PNG / JPEG / GIF), read by the MCP server; relative paths ' +
          'resolve against its working directory',
      ),
    data: z.string().optional().describe('Base64-encoded image bytes (PNG / JPG / GIF)'),
    url: z.string().optional().describe('Image URL to fetch instead of data'),
    name: z.string().optional().describe('Optional name for the new rectangle'),
    parentId: z.string().optional().describe('Parent node id (default: current page)'),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional().describe('Override width (default: image width)'),
    height: z.number().optional().describe('Override height (default: image height)'),
    scaleMode: z.enum(['FILL', 'FIT', 'CROP', 'TILE']).optional(),
  }),
  kind: 'write',
  // Resolved on the server into `data` before dispatch, so the sandbox handler never receives it.
  serverOnlyArgs: ['path'],
};

// The formats the sandbox's figma.createImage accepts. Checked here so a wrong file fails with its
// own path in the message instead of as an opaque decode error inside Figma.
const SIGNATURES: readonly (readonly number[])[] = [
  [0x89, 0x50, 0x4e, 0x47], // PNG
  [0xff, 0xd8, 0xff], // JPEG
  [0x47, 0x49, 0x46, 0x38], // GIF
];

const isSupportedImage = (bytes: Uint8Array): boolean =>
  SIGNATURES.some(signature => signature.every((byte, i) => bytes[i] === byte));

/** Bytes of header needed to recognise any of the signatures above. */
const HEADER_BYTES = 8;

/**
 * Ceiling on the file this will read.
 *
 * The bytes leave as base64 — 4/3 of the size — over a relay whose WebSocket refuses a frame past
 * 100MB, so a larger file could not arrive however it was handled. Refusing it from the header
 * costs nothing, where discovering it after the read costs the whole file in memory: a mis-typed
 * path (a video, an archive) would otherwise be buffered in full before anything objected.
 */
const MAX_FILE_BYTES = 72 * 1024 * 1024;

const megabytes = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1);

/**
 * The file's first bytes and its size, read from one handle.
 *
 * A directory is reported rather than left to fail later: `open` and `stat` both succeed on one (a
 * `path` of `''` resolves to the working directory, so this is reachable by accident), and only the
 * read would object — with Node's bare `EISDIR`, which names neither the path nor what was wrong
 * with it.
 *
 * `close` failures are swallowed: the handle is being discarded either way, and letting one throw
 * from `finally` would replace the real error — the reason the file could not be used — with a
 * cleanup detail.
 *
 * A short read leaves the rest of the buffer as the zeroes `Buffer.alloc` wrote, which no signature
 * matches, so a truncated file falls through to the same "not a PNG, JPEG or GIF" answer.
 */
const readImageHeader = async (file: string): Promise<{ header: Buffer; size: number }> => {
  const header = Buffer.alloc(HEADER_BYTES);
  const handle = await open(file, 'r');
  try {
    const stats = await handle.stat();
    if (stats.isDirectory()) {
      throw new Error(`import_image: ${file} is a directory, not an image file`);
    }
    await handle.read(header, 0, HEADER_BYTES, 0);
    return { header, size: stats.size };
  } finally {
    await handle.close().catch(() => {});
  }
};

/**
 * Replace a `path` argument with the file's bytes as base64 `data`, the form the sandbox handler
 * already accepts. Runs in the server the MCP client launched, so the file is read on the client's
 * own machine and only `data` ever crosses the relay — a caller on `/rpc` cannot make the leader
 * read a file. Arguments without `path` pass through untouched.
 *
 * The header and the size are checked before the file is read, not after: both answers live in the
 * first few bytes and the stat, so a wrong file is refused without being buffered.
 */
export const resolveImagePath = async (
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const { path, ...rest } = args;
  if (path === undefined) return args;
  if (typeof path !== 'string') throw new Error('import_image: path must be a string');
  if (rest.data !== undefined || rest.url !== undefined)
    throw new Error('import_image: provide exactly one of path, data or url');
  const file = resolve(path);

  const { header, size } = await readImageHeader(file);
  if (!isSupportedImage(header))
    throw new Error(`import_image: ${file} is not a PNG, JPEG or GIF image`);
  if (size > MAX_FILE_BYTES) {
    throw new Error(
      `import_image: ${file} is ${megabytes(size)}MB, over the ${megabytes(MAX_FILE_BYTES)}MB a ` +
        'single relay message can carry once base64-encoded — downscale or re-compress the file.',
    );
  }

  const bytes = await readFile(file);
  return { ...rest, data: bytes.toString('base64') };
};

/**
 * Re-raise a failed `import_image` dispatch with what the caller needs to act on it.
 *
 * Figma's ceilings are not ours to predict — `createImage` refuses anything over 4096px in either
 * dimension and says only "Image is too large", naming neither the file nor the limit. When the
 * bytes came from a `path` this side knows both, so the original message is kept and the missing
 * half added, the same shape `add_variable_mode` uses for the plan ceiling on modes. Any other
 * failure, and any call that did not use `path`, is returned untouched.
 */
export const importImageError = (err: unknown, path: unknown): unknown => {
  const message = err instanceof Error ? err.message : String(err);
  if (typeof path !== 'string' || !/too large/i.test(message)) return err;
  return new Error(
    `import_image: Figma refused ${resolve(path)} (${message}). createImage accepts at most ` +
      '4096px in width and height — downscale the image, or place it at full resolution outside ' +
      'Figma and import a view that fits.',
    { cause: err },
  );
};

/**
 * `batch` dispatches its ops straight to the sandbox, so an `import_image` op with a `path` has to
 * be resolved here too — otherwise the handler would answer "provide data or url" for an argument
 * the tool advertises. Other ops pass through unchanged.
 */
export const resolveBatchImagePaths = async (
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  if (!Array.isArray(args.ops)) return args;
  const ops = await Promise.all(
    args.ops.map(async (op: unknown) => {
      if (typeof op !== 'object' || op === null) return op;
      const { tool, params } = op as { tool?: unknown; params?: unknown };
      if (tool !== IMPORT_IMAGE_TOOL_NAME || typeof params !== 'object' || params === null)
        return op;
      return { ...op, params: await resolveImagePath(params as Record<string, unknown>) };
    }),
  );
  return { ...args, ops };
};
