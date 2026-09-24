import { readFile } from 'node:fs/promises';
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
    'by this machine, so it must be publicly reachable. The rectangle defaults to the image size ' +
    'unless width/height are given. scaleMode is FILL / FIT / CROP / TILE (default FILL). For vector ' +
    'SVG (logos / icons) use import_svg instead. Returns { ok, nodeId, name, type }.',
  inputSchema: z.object({
    path: z
      .string()
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

/**
 * Replace a `path` argument with the file's bytes as base64 `data`, the form the sandbox handler
 * already accepts. Runs in the server the MCP client launched, so the file is read on the client's
 * own machine and only `data` ever crosses the relay — a caller on `/rpc` cannot make the leader
 * read a file. Arguments without `path` pass through untouched.
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
  const bytes = await readFile(file);
  if (!isSupportedImage(bytes))
    throw new Error(`import_image: ${file} is not a PNG, JPEG or GIF image`);
  return { ...rest, data: bytes.toString('base64') };
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
