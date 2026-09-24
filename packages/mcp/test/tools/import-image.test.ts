import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  IMPORT_IMAGE_TOOL_NAME,
  importImageTool,
  resolveBatchImagePaths,
  resolveImagePath,
} from '../../src/tools/import-image.js';
import { WIRE_TOOL_SCHEMAS } from '../../src/tools/wire-schema.js';
import { toToolDefinition } from '../tool-schema.js';

// Smallest valid headers the signature check looks at, plus a few trailing bytes.
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

const dirs: string[] = [];
const fileWith = async (name: string, bytes: Uint8Array | string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'import-image-'));
  dirs.push(dir);
  const path = join(dir, name);
  await writeFile(path, bytes);
  return path;
};

afterEach(async () => {
  await Promise.all(dirs.map(d => rm(d, { recursive: true, force: true })));
  dirs.length = 0;
});

describe('import_image — definition', () => {
  it('advertises path to the agent', () => {
    const definition = toToolDefinition(importImageTool);
    expect(definition.inputSchema).toMatchObject({
      properties: { path: { type: 'string' }, data: { type: 'string' }, url: { type: 'string' } },
    });
  });

  it('keeps path off the wire to the plugin', () => {
    const wire = WIRE_TOOL_SCHEMAS.get(IMPORT_IMAGE_TOOL_NAME);
    expect(wire).toBeDefined();
    expect(Object.keys(wire?.shape ?? {})).not.toContain('path');
    expect(Object.keys(wire?.shape ?? {})).toContain('data');
  });
});

describe('resolveImagePath', () => {
  it.each([
    ['png', PNG],
    ['jpg', JPEG],
    ['gif', GIF],
  ])('turns a %s path into base64 data and keeps the other arguments', async (ext, bytes) => {
    const path = await fileWith(`photo.${ext}`, bytes);
    const resolved = await resolveImagePath({ path, parentId: '1:2', scaleMode: 'FILL' });
    expect(resolved).toEqual({
      data: Buffer.from(bytes).toString('base64'),
      parentId: '1:2',
      scaleMode: 'FILL',
    });
  });

  it('passes arguments without a path through unchanged', async () => {
    const args = { url: 'https://example.com/a.png', x: 10 };
    await expect(resolveImagePath(args)).resolves.toBe(args);
  });

  it('refuses a file that is not a PNG, JPEG or GIF, naming it', async () => {
    const path = await fileWith('notes.txt', 'not an image');
    await expect(resolveImagePath({ path })).rejects.toThrow(
      /notes\.txt is not a PNG, JPEG or GIF/,
    );
  });

  it('refuses path combined with data or url', async () => {
    const path = await fileWith('photo.png', PNG);
    await expect(resolveImagePath({ path, data: 'AAAA' })).rejects.toThrow(/exactly one of/);
    await expect(resolveImagePath({ path, url: 'https://example.com/a.png' })).rejects.toThrow(
      /exactly one of/,
    );
  });

  it('surfaces a missing file as an error', async () => {
    await expect(
      resolveImagePath({ path: join(tmpdir(), 'figwright-does-not-exist.png') }),
    ).rejects.toThrow(/ENOENT/);
  });
});

describe('resolveBatchImagePaths', () => {
  it('resolves import_image ops and leaves every other op untouched', async () => {
    const path = await fileWith('photo.png', PNG);
    const other = { tool: 'set_opacity', params: { nodeId: '1:2', opacity: 0.5 } };
    const resolved = await resolveBatchImagePaths({
      ops: [{ tool: IMPORT_IMAGE_TOOL_NAME, params: { path, parentId: '1:3' } }, other],
    });
    expect(resolved).toEqual({
      ops: [
        {
          tool: IMPORT_IMAGE_TOOL_NAME,
          params: { data: Buffer.from(PNG).toString('base64'), parentId: '1:3' },
        },
        other,
      ],
    });
  });

  it('passes a batch without ops through unchanged', async () => {
    const args = { ops: 'not-an-array' };
    await expect(resolveBatchImagePaths(args)).resolves.toBe(args);
  });
});
