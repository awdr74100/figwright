import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
  it('writes each fill to a hash-named file with the sniffed extension', async () => {
    const base = await makeDir();
    const dir = join(base, 'nested', 'assets');
    const nodes: NodeImageFills[] = [
      {
        nodeId: '1:1',
        images: [
          {
            index: 0,
            imageHash: 'abcHASH',
            base64: PNG_B64,
            width: 200,
            height: 100,
            scaleMode: 'FILL',
          },
          { index: 2, imageHash: 'jpgHASH', base64: JPG_B64, scaleMode: 'CROP' },
        ],
      },
    ];
    const result = await writeImageFills(dir, nodes);

    expect(result).toEqual({
      nodes: [
        {
          nodeId: '1:1',
          images: [
            {
              index: 0,
              imageHash: 'abcHASH',
              format: 'PNG',
              path: join(dir, 'abcHASH.png'),
              width: 200,
              height: 100,
              scaleMode: 'FILL',
            },
            {
              index: 2,
              imageHash: 'jpgHASH',
              format: 'JPG',
              path: join(dir, 'jpgHASH.jpg'),
              scaleMode: 'CROP',
            },
          ],
        },
      ],
    } satisfies SaveImageFillsResult);
    expect((await readFile(join(dir, 'abcHASH.png'))).toString('base64')).toBe(PNG_B64);
    expect((await readFile(join(dir, 'jpgHASH.jpg'))).toString('base64')).toBe(JPG_B64);
  });

  it('dedupes a shared imageHash to one file while every usage still maps to it', async () => {
    const dir = await makeDir();
    const nodes: NodeImageFills[] = [
      {
        nodeId: '1:1',
        images: [{ index: 0, imageHash: 'logo', base64: PNG_B64, scaleMode: 'FILL' }],
      },
      {
        nodeId: '2:2',
        images: [{ index: 0, imageHash: 'logo', base64: PNG_B64, scaleMode: 'FIT' }],
      },
    ];
    const result = await writeImageFills(dir, nodes);
    const shared = join(dir, 'logo.png');
    expect(result.nodes[0]?.images[0]?.path).toBe(shared);
    expect(result.nodes[1]?.images[0]?.path).toBe(shared);
    expect((await readFile(shared)).toString('base64')).toBe(PNG_B64);
  });

  it('returns path null (no write) for an unresolved image and passes mixed through', async () => {
    const dir = await makeDir();
    const nodes: NodeImageFills[] = [
      { nodeId: '1:1', images: [{ index: 0, imageHash: 'gone', base64: null, scaleMode: 'FILL' }] },
      { nodeId: '2:2', images: [{ index: 1, imageHash: null, base64: null }] },
      { nodeId: '3:3', images: [], mixed: true },
    ];
    const result = await writeImageFills(dir, nodes);
    expect(result.nodes[0]?.images[0]).toEqual({
      index: 0,
      imageHash: 'gone',
      path: null,
      scaleMode: 'FILL',
    });
    expect(result.nodes[1]?.images[0]).toEqual({ index: 1, imageHash: null, path: null });
    expect(result.nodes[2]).toEqual({ nodeId: '3:3', images: [], mixed: true });
    await expect(readFile(join(dir, 'gone.png'))).rejects.toThrow(/ENOENT/);
  });
});

describe('handleSaveImageFills', () => {
  it('dispatches save_image_fills with nodeIds and lands the bytes on disk', async () => {
    const dir = await makeDir();
    let dispatched: { tool: string; args: unknown } | null = null;
    const dispatch: ToolDispatcher = async (tool, args) => {
      dispatched = { tool, args };
      return {
        nodes: [{ nodeId: '1:1', images: [{ index: 0, imageHash: 'h', base64: PNG_B64 }] }],
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
      imageHash: 'h',
      format: 'PNG',
      path: join(dir, 'h.png'),
    });
    expect((await readFile(join(dir, 'h.png'))).toString('base64')).toBe(PNG_B64);
  });

  it('lands raw bytes when the plugin answers the binary request', async () => {
    const dir = await makeDir();
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const dispatch: ToolDispatcher = async () =>
      ({
        nodes: [{ nodeId: '1:1', images: [{ index: 0, imageHash: 'h', base64: null, bytes }] }],
      }) satisfies ImageFillsResult;

    const result = (await handleSaveImageFills(dispatch, {
      nodeIds: ['1:1'],
      outDir: dir,
    })) as SaveImageFillsResult;

    // Format detection reads magic bytes, so it has to work off the binary payload too.
    expect(result.nodes[0]?.images[0]).toEqual({
      index: 0,
      imageHash: 'h',
      format: 'PNG',
      path: join(dir, 'h.png'),
    });
    expect(new Uint8Array(await readFile(join(dir, 'h.png')))).toEqual(bytes);
  });

  it('rejects input missing outDir', async () => {
    await expect(handleSaveImageFills(emptyDispatch, { nodeIds: ['1:1'] })).rejects.toThrow(
      /outDir/,
    );
  });
});
