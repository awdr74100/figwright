import type { CreateResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createImportImageHandler } from '../../src/handlers/import-image.js';
import { noteRuntimeError, resetRuntimeForTests } from '../../src/runtime-ids.js';

interface FakeRect {
  id: string;
  name: string;
  type: string;
  width: number;
  height: number;
  x: number;
  y: number;
  fills: unknown;
  resize: (w: number, h: number) => void;
}

const makeFigma = (): {
  figma: typeof figma;
  rect: FakeRect;
  page: { appendChild: ReturnType<typeof vi.fn> };
} => {
  const rect: FakeRect = {
    id: 'R:1',
    name: 'Rectangle',
    type: 'RECTANGLE',
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    fills: [],
    resize(w, h) {
      this.width = w;
      this.height = h;
    },
  };
  const page = { appendChild: vi.fn<(n: unknown) => void>() };
  const figmaCtx = {
    base64Decode: (s: string) => new Uint8Array([s.length]),
    createImage: () => ({
      hash: 'HASH123',
      getSizeAsync: async () => ({ width: 200, height: 100 }),
    }),
    createImageAsync: async () => ({
      hash: 'URLHASH',
      getSizeAsync: async () => ({ width: 50, height: 50 }),
    }),
    createRectangle: () => rect,
    currentPage: page,
  } as unknown as typeof figma;
  return { figma: figmaCtx, rect, page };
};

describe('import_image handler', () => {
  it('decodes base64 data, sizes the rect to the image, and applies an IMAGE fill', async () => {
    const { figma: f, rect, page } = makeFigma();
    const result = (await createImportImageHandler(f)({
      data: 'abc',
      name: 'Hero',
    })) as CreateResult;

    expect(rect.width).toBe(200);
    expect(rect.height).toBe(100);
    expect(rect.fills).toEqual([{ type: 'IMAGE', scaleMode: 'FILL', imageHash: 'HASH123' }]);
    expect(page.appendChild).toHaveBeenCalledWith(rect);
    expect(result).toEqual({ ok: true, nodeId: 'R:1', name: 'Hero', type: 'RECTANGLE' });
  });

  it('fetches from url and honors width/height/scaleMode overrides', async () => {
    const { figma: f, rect } = makeFigma();
    await createImportImageHandler(f)({
      url: 'https://x/y.png',
      width: 64,
      height: 64,
      scaleMode: 'FIT',
    });
    expect(rect.width).toBe(64);
    expect(rect.height).toBe(64);
    expect(rect.fills).toEqual([{ type: 'IMAGE', scaleMode: 'FIT', imageHash: 'URLHASH' }]);
  });

  it('refuses without creating the image once the runtime ran out of callback ids', async () => {
    try {
      const { figma: f, page } = makeFigma();
      const created: unknown[] = [];
      const ctx = f as unknown as Record<string, unknown>;
      const original = ctx.createImage as (b: Uint8Array) => unknown;
      ctx.createImage = (b: Uint8Array) => (created.push(b), original(b));
      noteRuntimeError(
        new Error('in <unknown>: Attempted to invoke callback with invalid id -32761'),
      );
      await expect(createImportImageHandler(f)({ data: 'abc' })).rejects.toThrow(
        /^import_image: could not create the image\. .*reopen the plugin/,
      );
      await expect(createImportImageHandler(f)({ url: 'https://x/y.png' })).rejects.toThrow(
        /could not create the image/,
      );
      // The argument check still comes first.
      await expect(createImportImageHandler(f)({})).rejects.toThrow(/provide data/);
      expect(created).toEqual([]);
      expect(page.appendChild).not.toHaveBeenCalled();
    } finally {
      resetRuntimeForTests();
    }
  });

  it('throws when neither data nor url is given', async () => {
    const { figma: f } = makeFigma();
    await expect(createImportImageHandler(f)({ name: 'x' })).rejects.toThrow(/data .* or url/);
  });
});
