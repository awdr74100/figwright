import type { ImageFillsResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createSaveImageFillsHandler } from '../../src/handlers/save-image-fills.js';

const MIXED = Symbol('figma.mixed');

interface FakeImage {
  getBytesAsync: () => Promise<Uint8Array>;
  getSizeAsync: () => Promise<{ width: number; height: number }>;
}

const makeFigma = (
  nodes: Record<string, unknown>,
  images: Record<string, FakeImage | null>,
  getBytes = vi.fn<(h: string) => Promise<Uint8Array>>(),
): typeof figma =>
  ({
    mixed: MIXED,
    base64Encode: (bytes: Uint8Array) => `b64(${bytes.length})`,
    getNodeByIdAsync: async (id: string) => (nodes[id] ?? null) as BaseNode | null,
    getImageByHash: (hash: string) => {
      const img = images[hash];
      if (img === null || img === undefined) return null;
      // Route byte reads through the shared spy so tests can count fetches (dedup).
      return { ...img, getBytesAsync: () => getBytes(hash) };
    },
    __getBytes: getBytes,
  }) as unknown as typeof figma;

const imagePaint = (imageHash: string | null, scaleMode = 'FILL'): unknown => ({
  type: 'IMAGE',
  imageHash,
  scaleMode,
});

describe('save_image_fills handler', () => {
  it('extracts original bytes + intrinsic size + scaleMode per IMAGE fill, skipping non-image paints', async () => {
    const getBytes = vi.fn<() => Promise<Uint8Array>>(async () => new Uint8Array([1, 2, 3]));
    const f = makeFigma(
      {
        '1:1': {
          fills: [{ type: 'SOLID' }, imagePaint('h1', 'CROP'), imagePaint('h2', 'FIT')],
        },
      },
      {
        h1: { getBytesAsync: getBytes, getSizeAsync: async () => ({ width: 200, height: 100 }) },
        h2: { getBytesAsync: getBytes, getSizeAsync: async () => ({ width: 64, height: 64 }) },
      },
      getBytes,
    );

    const result = (await createSaveImageFillsHandler(f)({ nodeIds: ['1:1'] })) as ImageFillsResult;
    expect(result.nodes).toEqual([
      {
        nodeId: '1:1',
        images: [
          {
            index: 1,
            imageHash: 'h1',
            base64: 'b64(3)',
            width: 200,
            height: 100,
            scaleMode: 'CROP',
          },
          { index: 2, imageHash: 'h2', base64: 'b64(3)', width: 64, height: 64, scaleMode: 'FIT' },
        ],
      },
    ]);
  });

  it('returns raw bytes instead of base64 when the server asks for binary', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const getBytes = vi.fn<() => Promise<Uint8Array>>(async () => bytes);
    const f = makeFigma(
      { '1:1': { fills: [imagePaint('h')] } },
      { h: { getBytesAsync: getBytes, getSizeAsync: async () => ({ width: 10, height: 20 }) } },
      getBytes,
    );
    const result = (await createSaveImageFillsHandler(f)({
      nodeIds: ['1:1'],
      binary: true,
    })) as ImageFillsResult;
    expect(result.nodes[0]?.images[0]).toEqual({
      index: 0,
      imageHash: 'h',
      base64: null,
      bytes,
      width: 10,
      height: 20,
      scaleMode: 'FILL',
    });
  });

  it('fetches a shared imageHash exactly once across nodes/fills', async () => {
    const getBytes = vi.fn<() => Promise<Uint8Array>>(async () => new Uint8Array([9]));
    const f = makeFigma(
      {
        '1:1': { fills: [imagePaint('logo')] },
        '2:2': { fills: [imagePaint('logo'), imagePaint('logo')] },
      },
      { logo: { getBytesAsync: getBytes, getSizeAsync: async () => ({ width: 10, height: 10 }) } },
      getBytes,
    );

    const result = (await createSaveImageFillsHandler(f)({
      nodeIds: ['1:1', '2:2'],
    })) as ImageFillsResult;
    expect(result.nodes[0]?.images).toHaveLength(1);
    expect(result.nodes[1]?.images).toHaveLength(2);
    // Three usages of one asset → a single getBytesAsync call.
    expect(getBytes).toHaveBeenCalledTimes(1);
  });

  it('reports base64 null for an unresolvable hash and a null imageHash, without dropping scaleMode', async () => {
    const f = makeFigma(
      { '1:1': { fills: [imagePaint('gone'), imagePaint(null, 'TILE')] } },
      { gone: null },
    );
    const result = (await createSaveImageFillsHandler(f)({ nodeIds: ['1:1'] })) as ImageFillsResult;
    expect(result.nodes[0]?.images).toEqual([
      { index: 0, imageHash: 'gone', base64: null, scaleMode: 'FILL' },
      { index: 1, imageHash: null, base64: null, scaleMode: 'TILE' },
    ]);
  });

  it('returns empty images for a missing node or one with no fills property', async () => {
    const f = makeFigma({ '2:2': { type: 'GROUP' } }, {});
    const result = (await createSaveImageFillsHandler(f)({
      nodeIds: ['9:9', '2:2'],
    })) as ImageFillsResult;
    expect(result.nodes).toEqual([
      { nodeId: '9:9', images: [] },
      { nodeId: '2:2', images: [] },
    ]);
  });

  it('flags mixed fills instead of crashing on the symbol', async () => {
    const f = makeFigma({ '1:1': { fills: MIXED } }, {});
    const result = (await createSaveImageFillsHandler(f)({ nodeIds: ['1:1'] })) as ImageFillsResult;
    expect(result.nodes).toEqual([{ nodeId: '1:1', images: [], mixed: true }]);
  });

  it('throws on empty or non-string nodeIds', async () => {
    const f = makeFigma({}, {});
    await expect(createSaveImageFillsHandler(f)({ nodeIds: [] })).rejects.toThrow(/nodeIds/);
    await expect(createSaveImageFillsHandler(f)({ nodeIds: [1] })).rejects.toThrow(/nodeIds/);
  });
});
