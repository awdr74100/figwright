import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ImageFillsResult, NodeImageFills, SaveImageFillsResult } from '@figwright/shared';
import { afterEach, describe, expect, it } from 'vitest';

import {
  detectImageFormat,
  handleSaveImageFills,
  SAVE_IMAGE_FILLS_TOOL_NAME,
  saveImageFillsTool,
  type ToolDispatcher,
  writeImageFills,
} from '../../src/tools/save-image-fills.js';
import { toToolDefinition } from '../tool-schema.js';

const saveImageFillsToolDefinition = toToolDefinition(saveImageFillsTool);

// Minimal magic-byte payloads, base64-encoded the way the plugin ships them over the wire.
const b64 = (bytes: number[]): string => Buffer.from(bytes).toString('base64');
const PNG_B64 = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG_B64 = b64([0xff, 0xd8, 0xff, 0xe0, 0x00]);
// What Figma reports as imageHash: the SHA-1 of the bytes (measured), so these name the files.
const sha1 = (b64s: string): string =>
  createHash('sha1').update(Buffer.from(b64s, 'base64')).digest('hex');
const PNG_SHA1 = sha1(PNG_B64);
const JPG_SHA1 = sha1(JPG_B64);

const emptyDispatch: ToolDispatcher = async () => ({ nodes: [] }) satisfies ImageFillsResult;

const dirs: string[] = [];
const makeDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'save-image-fills-'));
  dirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(dirs.map(d => rm(d, { recursive: true, force: true })));
  dirs.length = 0;
});

describe('save_image_fills — definition', () => {
  it('requires nodeIds + outDir and is read-only (kind local)', () => {
    expect(saveImageFillsToolDefinition.name).toBe(SAVE_IMAGE_FILLS_TOOL_NAME);
    expect(saveImageFillsTool.kind).toBe('local');
    expect(saveImageFillsToolDefinition.inputSchema).toMatchObject({
      type: 'object',
      required: ['nodeIds', 'outDir'],
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
        outDir: { type: 'string' },
      },
    });
  });
});

describe('detectImageFormat', () => {
  it('recognizes PNG / JPG / GIF / WEBP by magic bytes', () => {
    expect(detectImageFormat(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toEqual({
      format: 'PNG',
      ext: 'png',
    });
    expect(detectImageFormat(Buffer.from([0xff, 0xd8, 0xff]))).toEqual({
      format: 'JPG',
      ext: 'jpg',
    });
    expect(detectImageFormat(Buffer.from([0x47, 0x49, 0x46, 0x38]))).toEqual({
      format: 'GIF',
      ext: 'gif',
    });
    const webp = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(detectImageFormat(webp)).toEqual({ format: 'WEBP', ext: 'webp' });
  });

  it('falls back to BIN for an unrecognized container (bytes still preserved)', () => {
    expect(detectImageFormat(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toEqual({
      format: 'BIN',
      ext: 'bin',
    });
  });
});

describe('writeImageFills', () => {
  it('writes each fill to a file named by its content hash, with the sniffed extension', async () => {
    const base = await makeDir();
    const dir = join(base, 'nested', 'assets');
    const nodes: NodeImageFills[] = [
      {
        nodeId: '1:1',
        images: [
          {
            index: 0,
            imageHash: PNG_SHA1,
            base64: PNG_B64,
            width: 200,
            height: 100,
            scaleMode: 'FILL',
          },
          { index: 2, imageHash: JPG_SHA1, base64: JPG_B64, scaleMode: 'CROP' },
        ],
      },
    ];
    const result = await writeImageFills(dir, nodes, ['1:1']);

    expect(result).toEqual({
      nodes: [
        {
          nodeId: '1:1',
          images: [
            {
              index: 0,
              imageHash: PNG_SHA1,
              format: 'PNG',
              path: join(dir, `${PNG_SHA1}.png`),
              width: 200,
              height: 100,
              scaleMode: 'FILL',
            },
            {
              index: 2,
              imageHash: JPG_SHA1,
              format: 'JPG',
              path: join(dir, `${JPG_SHA1}.jpg`),
              scaleMode: 'CROP',
            },
          ],
        },
      ],
    } satisfies SaveImageFillsResult);
    expect((await readFile(join(dir, `${PNG_SHA1}.png`))).toString('base64')).toBe(PNG_B64);
    expect((await readFile(join(dir, `${JPG_SHA1}.jpg`))).toString('base64')).toBe(JPG_B64);
  });

  it('dedupes an image reused across nodes to one file while every usage still maps to it', async () => {
    const dir = await makeDir();
    const nodes: NodeImageFills[] = [
      {
        nodeId: '1:1',
        images: [{ index: 0, imageHash: PNG_SHA1, base64: PNG_B64, scaleMode: 'FILL' }],
      },
      {
        nodeId: '2:2',
        images: [{ index: 0, imageHash: PNG_SHA1, base64: PNG_B64, scaleMode: 'FIT' }],
      },
    ];
    const result = await writeImageFills(dir, nodes, ['1:1', '2:2']);
    const shared = join(dir, `${PNG_SHA1}.png`);
    expect(result.nodes[0]?.images[0]?.path).toBe(shared);
    expect(result.nodes[1]?.images[0]?.path).toBe(shared);
    expect(await readdir(dir)).toEqual([`${PNG_SHA1}.png`]);
  });

  it('returns path null (no write) for an unresolved image and passes mixed through', async () => {
    const dir = await makeDir();
    const nodes: NodeImageFills[] = [
      {
        nodeId: '1:1',
        images: [{ index: 0, imageHash: PNG_SHA1, base64: null, scaleMode: 'FILL' }],
      },
      { nodeId: '2:2', images: [{ index: 1, imageHash: null, base64: null }] },
      { nodeId: '3:3', images: [], mixed: true },
    ];
    const result = await writeImageFills(dir, nodes, ['1:1', '2:2', '3:3']);
    expect(result.nodes[0]?.images[0]).toEqual({
      index: 0,
      imageHash: PNG_SHA1,
      path: null,
      scaleMode: 'FILL',
    });
    expect(result.nodes[1]?.images[0]).toEqual({ index: 1, imageHash: null, path: null });
    expect(result.nodes[2]).toEqual({ nodeId: '3:3', images: [], mixed: true });
    expect(await readdir(dir)).toEqual([]);
  });

  // The reply is cast, never re-parsed on the wire: none of what follows is a reply a real plugin
  // sends, and none of it may choose where a file lands or which file it replaces.

  it('names the file from its bytes, so a reply cannot pick an existing file to overwrite', async () => {
    const dir = await makeDir();
    await writeFile(join(dir, 'logo.png'), 'original');
    const result = await writeImageFills(
      dir,
      [{ nodeId: '1:1', images: [{ index: 0, imageHash: 'logo', base64: PNG_B64 }] }],
      ['1:1'],
    );
    // The prior code named the file after imageHash and overwrote logo.png.
    expect(result.nodes[0]?.images[0]?.path).toBe(join(dir, `${PNG_SHA1}.png`));
    expect(await readFile(join(dir, 'logo.png'), 'utf8')).toBe('original');
  });

  it('names the file from its bytes even when imageHash carries separators, and stays in outDir', async () => {
    const base = await makeDir();
    const dir = join(base, 'nested', 'assets');
    const escape = join('..', '..', 'pwned');
    const result = await writeImageFills(
      dir,
      [{ nodeId: '1:1', images: [{ index: 0, imageHash: escape, base64: PNG_B64 }] }],
      ['1:1'],
    );
    expect(result.nodes[0]?.images[0]?.path).toBe(join(dir, `${PNG_SHA1}.png`));
    expect(await readdir(base)).toEqual(['nested']);
  });

  it('writes nothing for a node that was not requested', async () => {
    const dir = await makeDir();
    const result = await writeImageFills(
      dir,
      [
        { nodeId: '1:1', images: [{ index: 0, imageHash: PNG_SHA1, base64: PNG_B64 }] },
        { nodeId: '9:9', images: [{ index: 0, imageHash: JPG_SHA1, base64: JPG_B64 }] },
        { nodeId: '__proto__', images: [{ index: 0, imageHash: JPG_SHA1, base64: JPG_B64 }] },
      ],
      ['1:1'],
    );
    expect(result.nodes.map(n => n.images[0]?.path)).toEqual([
      join(dir, `${PNG_SHA1}.png`),
      null,
      null,
    ]);
    expect(await readdir(dir)).toEqual([`${PNG_SHA1}.png`]);
  });
});

describe('handleSaveImageFills', () => {
  it('dispatches save_image_fills with nodeIds and lands the bytes on disk', async () => {
    const dir = await makeDir();
    let dispatched: { tool: string; args: unknown } | null = null;
    const dispatch: ToolDispatcher = async (tool, args) => {
      dispatched = { tool, args };
      return {
        nodes: [{ nodeId: '1:1', images: [{ index: 0, imageHash: PNG_SHA1, base64: PNG_B64 }] }],
      } satisfies ImageFillsResult;
    };

    const result = (await handleSaveImageFills(dispatch, {
      nodeIds: ['1:1'],
      outDir: dir,
    })) as SaveImageFillsResult;

    expect(dispatched).toEqual({
      tool: 'save_image_fills',
      args: { binary: true, nodeIds: ['1:1'] },
    });
    expect(result.nodes[0]?.images[0]).toEqual({
      index: 0,
      imageHash: PNG_SHA1,
      format: 'PNG',
      path: join(dir, `${PNG_SHA1}.png`),
    });
    expect((await readFile(join(dir, `${PNG_SHA1}.png`))).toString('base64')).toBe(PNG_B64);
  });

  it('lands raw bytes when the plugin answers the binary request', async () => {
    const dir = await makeDir();
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const dispatch: ToolDispatcher = async () =>
      ({
        nodes: [
          { nodeId: '1:1', images: [{ index: 0, imageHash: PNG_SHA1, base64: null, bytes }] },
        ],
      }) satisfies ImageFillsResult;

    const result = (await handleSaveImageFills(dispatch, {
      nodeIds: ['1:1'],
      outDir: dir,
    })) as SaveImageFillsResult;

    // Format detection reads magic bytes, so it has to work off the binary payload too.
    expect(result.nodes[0]?.images[0]).toEqual({
      index: 0,
      imageHash: PNG_SHA1,
      format: 'PNG',
      path: join(dir, `${PNG_SHA1}.png`),
    });
    expect(new Uint8Array(await readFile(join(dir, `${PNG_SHA1}.png`)))).toEqual(bytes);
  });

  it('rejects input missing outDir', async () => {
    await expect(handleSaveImageFills(emptyDispatch, { nodeIds: ['1:1'] })).rejects.toThrow(
      /outDir/,
    );
  });
});
