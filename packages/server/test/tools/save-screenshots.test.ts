import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
        scale: { type: 'number', minimum: 0 },
      },
    });
  });
});

describe('writeScreenshots', () => {
  it('writes each image to a sanitized filename and creates missing dirs', async () => {
    const base = await makeDir();
    const dir = join(base, 'nested', 'shots');
    const images: ScreenshotImage[] = [
      { nodeId: '1:1', format: 'PNG', base64: 'AAAA' },
      { nodeId: '2:3', format: 'SVG', base64: 'BBBB' },
    ];
    const result = await writeScreenshots(dir, images);

    expect(result.saved).toEqual([
      { nodeId: '1:1', format: 'PNG', path: join(dir, '1-1.png') },
      { nodeId: '2:3', format: 'SVG', path: join(dir, '2-3.svg') },
    ]);
    expect((await readFile(join(dir, '1-1.png'))).toString('base64')).toBe('AAAA');
    expect((await readFile(join(dir, '2-3.svg'))).toString('base64')).toBe('BBBB');
  });

  it('returns path null for non-exportable nodes without writing', async () => {
    const dir = await makeDir();
    const result = await writeScreenshots(dir, [{ nodeId: '9:9', format: 'PNG', base64: null }]);
    expect(result.saved).toEqual([{ nodeId: '9:9', format: 'PNG', path: null }]);
    await expect(readFile(join(dir, '9-9.png'))).rejects.toThrow(/ENOENT/);
  });

  it('passes the empty flag through (file still written, but flagged blank)', async () => {
    const dir = await makeDir();
    const result = await writeScreenshots(dir, [
      { nodeId: '1:1', format: 'PNG', base64: 'AAAA', empty: true },
    ]);
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

    expect(dispatched).toEqual({ tool: 'get_screenshot', args: { nodeIds: ['1:1'] } });
    expect(result.saved[0]).toEqual({ nodeId: '1:1', format: 'PNG', path: join(dir, '1-1.png') });
    expect((await readFile(join(dir, '1-1.png'))).toString('base64')).toBe('AAAA');
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
    expect(forwarded).toEqual({ nodeIds: ['1:1'], format: 'JPG', scale: 2 });
  });

  it('rejects input missing outDir', async () => {
    await expect(handleSaveScreenshots(emptyDispatch, { nodeIds: ['1:1'] })).rejects.toThrow(
      /outDir/,
    );
  });
});
