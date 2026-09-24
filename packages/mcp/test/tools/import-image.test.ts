import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  IMPORT_IMAGE_TOOL_NAME,
  importImageError,
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

/** A sparse file: the header is real, `truncate` makes stat report `size` without writing it. */
const sparseFileWith = async (name: string, header: Uint8Array, size: number): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'import-image-'));
  dirs.push(dir);
  const path = join(dir, name);
  const handle = await open(path, 'w');
  try {
    await handle.write(header);
    await handle.truncate(size);
  } finally {
    await handle.close();
  }
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

describe('import_image — guards before the read', () => {
  it('refuses a file too large for one relay message, naming both sizes', async () => {
    // 80MB of declared size: past the cap, and base64 of it past what the relay's WebSocket takes.
    const path = await sparseFileWith('huge.png', PNG, 80 * 1024 * 1024);
    await expect(resolveImagePath({ path })).rejects.toThrow(/80\.0MB, over the 72\.0MB/);
    // The message has to name the file, the way the wrong-format one does.
    await expect(resolveImagePath({ path })).rejects.toThrow(path);
  });

  // No "just under the cap" case on purpose: it would have to be read for real (a 71MB sparse file
  // becomes 71MB of buffer and 95MB of base64), and the accepting path is already covered by the
  // small-file cases above — the same code, without the memory.

  // `path: ''` resolves to the working directory, and open()/stat() both succeed on a directory —
  // only the read would object, with a bare EISDIR naming neither the path nor the problem. A batch
  // op's params never pass the tool's own schema, so `min(1)` alone would not cover this.
  it('refuses a directory by name rather than failing as EISDIR', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'import-image-'));
    dirs.push(dir);
    await expect(resolveImagePath({ path: dir })).rejects.toThrow(/is a directory, not an image/);
    await expect(
      resolveBatchImagePaths({ ops: [{ tool: IMPORT_IMAGE_TOOL_NAME, params: { path: '' } }] }),
    ).rejects.toThrow(/is a directory, not an image/);
  });

  it('still refuses a file shorter than the signature it would need', async () => {
    const path = await fileWith('tiny.png', Uint8Array.from([0x89, 0x50]));
    await expect(resolveImagePath({ path })).rejects.toThrow(/is not a PNG, JPEG or GIF image/);
  });
});

describe('importImageError', () => {
  const tooLarge = new Error('in createImage: Image is too large');
  // Built from tmpdir rather than written as a POSIX literal: the message carries resolve(path), so
  // on Windows a literal '/tmp/shot.png' comes back as 'D:\tmp\shot.png' and the assertion would be
  // looking for the wrong separator — a difference no local run on macOS or Linux can show.
  const file = join(tmpdir(), 'shot.png');

  it("adds the file and Figma's ceiling to a size rejection", () => {
    const wrapped = importImageError(tooLarge, file) as Error;
    expect(wrapped.message).toContain(file);
    expect(wrapped.message).toMatch(/4096px/);
    // Figma's own words stay in, so the cause is never replaced by our paraphrase.
    expect(wrapped.message).toMatch(/Image is too large/);
    expect(wrapped.cause).toBe(tooLarge);
  });

  it('leaves a call that used data or url untouched', () => {
    expect(importImageError(tooLarge, undefined)).toBe(tooLarge);
  });

  it('leaves every other failure untouched', () => {
    const other = new Error('relay: plugin not connected');
    expect(importImageError(other, file)).toBe(other);
  });
});
