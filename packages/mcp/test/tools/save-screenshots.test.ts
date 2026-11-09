import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  GetScreenshotResult,
  SaveScreenshotsResult,
  ScreenshotImage,
} from '@figwright/shared';
import { afterEach, describe, expect, it } from 'vitest';

import {
  handleSaveScreenshots,
  SAVE_SCREENSHOTS_TOOL_NAME,
  saveScreenshotsTool,
  type ScreenshotRequest,
  type ToolDispatcher,
  writeScreenshots,
} from '../../src/tools/save-screenshots.js';
import { toToolDefinition } from '../tool-schema.js';

const saveScreenshotsToolDefinition = toToolDefinition(saveScreenshotsTool);

const emptyDispatch: ToolDispatcher = async () => ({ images: [] }) satisfies GetScreenshotResult;

const dirs: string[] = [];
const makeDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'save-screenshots-'));
  dirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(dirs.map(d => rm(d, { recursive: true, force: true })));
  dirs.length = 0;
});

describe('save_screenshots — definition', () => {
  it('requires nodeIds + outDir and declares format / scale', () => {
    expect(saveScreenshotsToolDefinition.name).toBe(SAVE_SCREENSHOTS_TOOL_NAME);
    expect(saveScreenshotsToolDefinition.inputSchema).toMatchObject({
      type: 'object',
      required: ['nodeIds', 'outDir'],
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
        outDir: { type: 'string' },
        format: { type: 'string', enum: ['PNG', 'JPG', 'SVG'] },
        // .positive() — the plugin rejects scale <= 0, so the advertised schema must too
        scale: { type: 'number', exclusiveMinimum: 0 },
      },
    });
  });
});

describe('writeScreenshots', () => {
  const asked = (format: ScreenshotRequest['format'], ...nodeIds: string[]): ScreenshotRequest => ({
    nodeIds,
    format,
  });

  it('writes each requested image to a sanitized filename and creates missing dirs', async () => {
    const base = await makeDir();
    const dir = join(base, 'nested', 'shots');
    const images: ScreenshotImage[] = [
      { nodeId: '1:1', format: 'PNG', base64: 'AAAA' },
      { nodeId: '2:3', format: 'PNG', base64: 'BBBB' },
    ];
    const result = await writeScreenshots(dir, images, asked('PNG', '1:1', '2:3'));

    expect(result.saved).toEqual([
      { nodeId: '1:1', format: 'PNG', path: join(dir, '1-1.png') },
      { nodeId: '2:3', format: 'PNG', path: join(dir, '2-3.png') },
    ]);
    expect((await readFile(join(dir, '1-1.png'))).toString('base64')).toBe('AAAA');
    expect((await readFile(join(dir, '2-3.png'))).toString('base64')).toBe('BBBB');
  });

  it.each([
    ['JPG', 'jpg'],
    ['SVG', 'svg'],
  ] as const)('names a %s export with the .%s extension', async (format, ext) => {
    const dir = await makeDir();
    const result = await writeScreenshots(
      dir,
      [{ nodeId: '2:3', format, base64: 'BBBB' }],
      asked(format, '2:3'),
    );
    expect(result.saved).toEqual([{ nodeId: '2:3', format, path: join(dir, `2-3.${ext}`) }]);
    expect((await readFile(join(dir, `2-3.${ext}`))).toString('base64')).toBe('BBBB');
  });

  it('returns path null for non-exportable nodes without writing', async () => {
    const dir = await makeDir();
    const result = await writeScreenshots(
      dir,
      [{ nodeId: '9:9', format: 'PNG', base64: null }],
      asked('PNG', '9:9'),
    );
    expect(result.saved).toEqual([{ nodeId: '9:9', format: 'PNG', path: null }]);
    await expect(readFile(join(dir, '9-9.png'))).rejects.toThrow(/ENOENT/);
  });

  // The reply is cast, never re-parsed on the wire, so everything below is a reply a real plugin
  // never sends — and none of it may choose where a file lands or what it is called.

  it('never lets a format string escape outDir, and writes nothing for it', async () => {
    const base = await makeDir();
    const dir = join(base, 'nested', 'shots');
    // With outDir two levels under `base`, this climbs past both into `base` itself — the prior
    // code, which fell back to the raw format as the extension, wrote the bytes to `base/pwned`.
    const escape = join('..', '..', '..', '..', 'pwned');
    const result = await writeScreenshots(
      dir,
      [{ nodeId: '1:1', format: escape, base64: 'AAAA' }],
      asked('PNG', '1:1'),
    );

    expect(result.saved).toEqual([{ nodeId: '1:1', format: escape, path: null }]);
    await expect(readFile(join(base, 'pwned'))).rejects.toThrow(/ENOENT/);
    expect(await readdir(dir)).toEqual([]);
  });

  it.each(['SVG', 'JPG', 'WEBP', '__proto__', 'constructor'])(
    'writes nothing when the reply claims %s for a PNG request',
    async format => {
      // A different known format would otherwise put an SVG — markup that can carry script — where
      // a PNG was asked for; an unknown or inherited name has no extension at all.
      const dir = await makeDir();
      const result = await writeScreenshots(
        dir,
        [{ nodeId: '1:1', format, base64: 'AAAA' }],
        asked('PNG', '1:1'),
      );
      expect(result.saved).toEqual([{ nodeId: '1:1', format, path: null }]);
      expect(await readdir(dir)).toEqual([]);
    },
  );

  it('never writes a node that was not requested, so no other file in outDir is overwritten', async () => {
    const dir = await makeDir();
    await writeFile(join(dir, 'logo.png'), 'original');
    const result = await writeScreenshots(
      dir,
      [
        { nodeId: '1:1', format: 'PNG', base64: 'AAAA' },
        { nodeId: 'logo', format: 'PNG', base64: 'BBBB' },
        { nodeId: '__proto__', format: 'PNG', base64: 'CCCC' },
      ],
      asked('PNG', '1:1'),
    );

    expect(result.saved).toEqual([
      { nodeId: '1:1', format: 'PNG', path: join(dir, '1-1.png') },
      { nodeId: 'logo', format: 'PNG', path: null },
      { nodeId: '__proto__', format: 'PNG', path: null },
    ]);
    expect(await readFile(join(dir, 'logo.png'), 'utf8')).toBe('original');
    expect((await readdir(dir)).toSorted()).toEqual(['1-1.png', 'logo.png']);
  });

  it('passes the empty flag through (file still written, but flagged blank)', async () => {
    const dir = await makeDir();
    const result = await writeScreenshots(
      dir,
      [{ nodeId: '1:1', format: 'PNG', base64: 'AAAA', empty: true }],
      asked('PNG', '1:1'),
    );
    expect(result.saved).toEqual([
      { nodeId: '1:1', format: 'PNG', path: join(dir, '1-1.png'), empty: true },
    ]);
  });
});

describe('handleSaveScreenshots', () => {
  it('dispatches get_screenshot and lands the images on disk', async () => {
    const dir = await makeDir();
    let dispatched: { tool: string; args: unknown } | null = null;
    const dispatch: ToolDispatcher = async (tool, args) => {
      dispatched = { tool, args };
      return {
        images: [{ nodeId: '1:1', format: 'PNG', base64: 'AAAA' }],
      } satisfies GetScreenshotResult;
    };

    const result = (await handleSaveScreenshots(dispatch, {
      nodeIds: ['1:1'],
      outDir: dir,
    })) as SaveScreenshotsResult;

    // scale:1 is always forwarded explicitly — an omitted scale would make get_screenshot auto-fit
    // the raster for model consumption, but files on disk are user artifacts and stay full-res. The
    // default format is explicit too: files are named from this request, so it must not rest on the
    // plugin's own default agreeing.
    expect(dispatched).toEqual({
      tool: 'get_screenshot',
      args: { binary: true, nodeIds: ['1:1'], format: 'PNG', scale: 1 },
    });
    expect(result.saved[0]).toEqual({ nodeId: '1:1', format: 'PNG', path: join(dir, '1-1.png') });
    expect((await readFile(join(dir, '1-1.png'))).toString('base64')).toBe('AAAA');
  });

  it('lands raw bytes when the plugin answers the binary request', async () => {
    const dir = await makeDir();
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]);
    const dispatch: ToolDispatcher = async () =>
      ({
        images: [{ nodeId: '1:1', format: 'PNG', base64: null, bytes }],
      }) satisfies GetScreenshotResult;

    const result = (await handleSaveScreenshots(dispatch, {
      nodeIds: ['1:1'],
      outDir: dir,
    })) as SaveScreenshotsResult;

    expect(result.saved[0]).toEqual({ nodeId: '1:1', format: 'PNG', path: join(dir, '1-1.png') });
    expect(new Uint8Array(await readFile(join(dir, '1-1.png')))).toEqual(bytes);
  });

  it('forwards format and scale to get_screenshot', async () => {
    const dir = await makeDir();
    let forwarded: unknown = null;
    const dispatch: ToolDispatcher = async (_tool, args) => {
      forwarded = args;
      return { images: [] } satisfies GetScreenshotResult;
    };
    await handleSaveScreenshots(dispatch, {
      nodeIds: ['1:1'],
      outDir: dir,
      format: 'JPG',
      scale: 2,
    });
    expect(forwarded).toEqual({ binary: true, nodeIds: ['1:1'], format: 'JPG', scale: 2 });
  });

  it('rejects input missing outDir', async () => {
    await expect(handleSaveScreenshots(emptyDispatch, { nodeIds: ['1:1'] })).rejects.toThrow(
      /outDir/,
    );
  });
});
