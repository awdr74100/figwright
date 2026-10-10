import type { ImageFillResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createBatchHandler } from '../../src/handlers/batch.js';
import { createSetImageFillHandler } from '../../src/handlers/set-image-fill.js';

const MIXED = Symbol('mixed');
const SOLID = {
  type: 'SOLID',
  color: { r: 0.9, g: 0.9, b: 0.9 },
  opacity: 0.4,
  visible: true,
  blendMode: 'MULTIPLY',
  boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'V:1' } },
};
const CROPPED = {
  type: 'IMAGE',
  imageHash: 'old',
  scaleMode: 'CROP',
  imageTransform: [
    [0.5, 0, 0.25],
    [0, 0.5, 0.1],
  ],
  filters: { exposure: 0.2 },
  opacity: 0.8,
};

const makeFigma = (nodes: Record<string, unknown>, opts: { reject?: boolean } = {}) => {
  type FakeImage = { hash: string; getSizeAsync: () => Promise<{ width: number; height: number }> };
  const createImage = vi.fn<(bytes: Uint8Array) => FakeImage>(bytes => {
    if (opts.reject === true) throw new Error('Image is too large');
    return {
      hash: `hash-${bytes.length}`,
      getSizeAsync: async () => ({ width: 640, height: 480 }),
    };
  });
  const createImageAsync = vi.fn<(url: string) => Promise<FakeImage>>(async url => ({
    hash: `url:${url}`,
    getSizeAsync: async () => ({ width: 32, height: 32 }),
  }));
  const figmaCtx = {
    mixed: MIXED,
    root: { children: [] },
    currentPage: { id: '0:1' },
    base64Decode: (s: string) => new Uint8Array(s.length),
    createImage,
    createImageAsync,
    getNodeByIdAsync: async (id: string) => nodes[id] ?? null,
    getStyleByIdAsync: async () => null,
    variables: { getVariableByIdAsync: async (id: string) => ({ id }) },
  } as unknown as typeof figma;
  return { figmaCtx, createImage, createImageAsync };
};

const frame = (fills: unknown, extra: Record<string, unknown> = {}) => ({
  id: '1:1',
  type: 'FRAME',
  fills,
  fillStyleId: '',
  ...extra,
});

describe('set_image_fill handler', () => {
  it('swaps only the picture in the topmost IMAGE fill, keeping its crop, filters and opacity', async () => {
    const node = frame([SOLID, CROPPED, { ...CROPPED, imageHash: 'top' }]);
    const { figmaCtx } = makeFigma({ '1:1': node });
    const result = (await createSetImageFillHandler(figmaCtx)({
      nodeId: '1:1',
      data: 'abcd',
    })) as ImageFillResult;

    expect(result).toEqual({
      ok: true,
      nodeId: '1:1',
      index: 2,
      imageHash: 'hash-4',
      width: 640,
      height: 480,
    });
    expect(node.fills).toEqual([SOLID, CROPPED, { ...CROPPED, imageHash: 'hash-4' }]);
  });

  it('drops the old transform when the scale mode changes', async () => {
    const node = frame([{ ...CROPPED, scalingFactor: 0.5 }]);
    const { figmaCtx } = makeFigma({ '1:1': node });
    await createSetImageFillHandler(figmaCtx)({ nodeId: '1:1', data: 'ab', scaleMode: 'FIT' });
    expect(node.fills).toEqual([
      {
        type: 'IMAGE',
        imageHash: 'hash-2',
        scaleMode: 'FIT',
        filters: { exposure: 0.2 },
        opacity: 0.8,
      },
    ]);
  });

  it('adds the image on top when the node has no image fill, keeping the fills below', async () => {
    const node = frame([SOLID]);
    const { figmaCtx } = makeFigma({ '1:1': node });
    const result = (await createSetImageFillHandler(figmaCtx)({
      nodeId: '1:1',
      data: 'ab',
    })) as ImageFillResult;
    expect(result.index).toBe(1);
    expect(node.fills).toEqual([SOLID, { type: 'IMAGE', scaleMode: 'FILL', imageHash: 'hash-2' }]);
  });

  it("replaces the fill at index, keeping that layer's visibility, opacity and blend but not its colour or binding", async () => {
    const node = frame([SOLID, CROPPED]);
    const { figmaCtx } = makeFigma({ '1:1': node });
    await createSetImageFillHandler(figmaCtx)({
      nodeId: '1:1',
      data: 'ab',
      index: 0,
      scaleMode: 'TILE',
    });
    expect(node.fills).toEqual([
      {
        type: 'IMAGE',
        scaleMode: 'TILE',
        imageHash: 'hash-2',
        visible: true,
        opacity: 0.4,
        blendMode: 'MULTIPLY',
      },
      CROPPED,
    ]);
  });

  it('fetches a url through Figma', async () => {
    const node = frame([]);
    const { figmaCtx, createImageAsync } = makeFigma({ '1:1': node });
    await createSetImageFillHandler(figmaCtx)({ nodeId: '1:1', url: 'https://x/a.png' });
    expect(createImageAsync).toHaveBeenCalledWith('https://x/a.png');
    expect(node.fills).toEqual([
      { type: 'IMAGE', scaleMode: 'FILL', imageHash: 'url:https://x/a.png' },
    ]);
  });

  it('leaves the fills alone when Figma refuses the image', async () => {
    const node = frame([SOLID]);
    const { figmaCtx } = makeFigma({ '1:1': node }, { reject: true });
    await expect(
      createSetImageFillHandler(figmaCtx)({ nodeId: '1:1', data: 'ab' }),
    ).rejects.toThrow('Image is too large');
    expect(node.fills).toEqual([SOLID]);
  });

  it('refuses before creating anything: bad index, mixed text fills, no fills, both or neither source', async () => {
    const { figmaCtx, createImage } = makeFigma({
      '1:1': frame([SOLID]),
      '1:2': { id: '1:2', type: 'TEXT', fills: MIXED },
      '1:3': { id: '1:3', type: 'GROUP' },
    });
    const handler = createSetImageFillHandler(figmaCtx);
    await expect(handler({ nodeId: '1:1', data: 'ab', index: 1 })).rejects.toThrow(
      'has 1 fill(s), so index 1 is out of range',
    );
    await expect(handler({ nodeId: '1:2', data: 'ab' })).rejects.toThrow(
      'different fills across its characters',
    );
    await expect(handler({ nodeId: '1:3', data: 'ab' })).rejects.toThrow('cannot have fills');
    await expect(handler({ nodeId: '1:1', data: 'ab', url: 'u' })).rejects.toThrow('exactly one');
    await expect(handler({ nodeId: '1:1' })).rejects.toThrow('exactly one');
    await expect(handler({ nodeId: '1:1', data: 'ab', scaleMode: 'STRETCH' })).rejects.toThrow(
      'scaleMode must be one of',
    );
    expect(createImage).not.toHaveBeenCalled();
  });

  it('reports a fill Figma did not keep instead of claiming it', async () => {
    const node = {
      id: '1:1',
      type: 'FRAME',
      get fills() {
        return [SOLID];
      },
      set fills(_v: unknown) {},
    };
    const { figmaCtx } = makeFigma({ '1:1': node });
    await expect(
      createSetImageFillHandler(figmaCtx)({ nodeId: '1:1', data: 'ab' }),
    ).rejects.toThrow('Figma did not keep the image in fill 1');
  });
});

describe('set_image_fill in a batch', () => {
  it('puts the previous fills and the fill style back', async () => {
    const setFillStyleIdAsync = vi.fn<(this: { fillStyleId: string }, id: string) => Promise<void>>(
      async function (this: { fillStyleId: string }, id: string) {
        this.fillStyleId = id;
      },
    );
    const node = frame([SOLID], { fillStyleId: 'S:surface', setFillStyleIdAsync });
    // Like Figma: assigning fills unlinks the style.
    let fills: unknown = [SOLID];
    Object.defineProperty(node, 'fills', {
      get: () => fills,
      set: (v: unknown) => {
        fills = v;
        node.fillStyleId = '';
      },
    });
    const { figmaCtx } = makeFigma({ '1:1': node });
    const handler = createBatchHandler(figmaCtx, {
      set_image_fill: createSetImageFillHandler(figmaCtx),
    });

    await expect(
      handler({
        ops: [
          { tool: 'set_image_fill', params: { nodeId: '1:1', data: 'ab' } },
          { tool: 'set_image_fill', params: { nodeId: '1:1', data: 'ab', index: 9 } },
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);
    expect(fills).toEqual([SOLID]);
    expect(node.fillStyleId).toBe('S:surface');
  });
});
