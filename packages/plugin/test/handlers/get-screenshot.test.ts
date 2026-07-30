import type { GetScreenshotResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createGetScreenshotHandler } from '../../src/handlers/get-screenshot.js';

interface ExportCall {
  format: string;
  constraint?: { type: string; value: number };
  useAbsoluteBounds?: boolean;
}

const fakeFigma = (
  lookup: Record<string, BaseNode | null>,
  calls: ExportCall[] = [],
): typeof figma =>
  ({
    base64Encode: (bytes: Uint8Array) => `b64(${bytes.length})`,
    getNodeByIdAsync: async (id: string) => lookup[id] ?? null,
    // capture passthrough for assertions
    __calls: calls,
  }) as unknown as typeof figma;

const exportable = (id: string, calls: ExportCall[]): BaseNode =>
  ({
    id,
    exportAsync: async (settings: ExportCall) => {
      calls.push(settings);
      return new Uint8Array([1, 2, 3]);
    },
  }) as unknown as BaseNode;

describe('get_screenshot handler', () => {
  it('exports each node to base64 with PNG + scale by default', async () => {
    const calls: ExportCall[] = [];
    const handler = createGetScreenshotHandler(
      fakeFigma({ '1:1': exportable('1:1', calls), '1:2': exportable('1:2', calls) }, calls),
    );
    const result = (await handler({ nodeIds: ['1:1', '1:2'] })) as GetScreenshotResult;
    expect(result.images).toEqual([
      { nodeId: '1:1', format: 'PNG', base64: 'b64(3)' },
      { nodeId: '1:2', format: 'PNG', base64: 'b64(3)' },
    ]);
    expect(calls[0]).toEqual({ format: 'PNG', constraint: { type: 'SCALE', value: 1 } });
  });

  it('passes scale through for raster formats', async () => {
    const calls: ExportCall[] = [];
    const handler = createGetScreenshotHandler(
      fakeFigma({ '1:1': exportable('1:1', calls) }, calls),
    );
    await handler({ nodeIds: ['1:1'], format: 'JPG', scale: 2 });
    expect(calls[0]).toEqual({ format: 'JPG', constraint: { type: 'SCALE', value: 2 } });
  });

  it('uses constraint-free settings for SVG', async () => {
    const calls: ExportCall[] = [];
    const handler = createGetScreenshotHandler(
      fakeFigma({ '1:1': exportable('1:1', calls) }, calls),
    );
    await handler({ nodeIds: ['1:1'], format: 'SVG' });
    expect(calls[0]).toEqual({ format: 'SVG' });
  });

  it('returns null base64 for missing or non-exportable nodes', async () => {
    const handler = createGetScreenshotHandler(
      fakeFigma({ '1:9': null, '1:8': { id: '1:8' } as unknown as BaseNode }),
    );
    const result = (await handler({ nodeIds: ['1:9', '1:8'] })) as GetScreenshotResult;
    expect(result.images).toEqual([
      { nodeId: '1:9', format: 'PNG', base64: null },
      { nodeId: '1:8', format: 'PNG', base64: null },
    ]);
  });

  it('flags empty:true when the node rendered nothing (absoluteRenderBounds null)', async () => {
    const calls: ExportCall[] = [];
    const clipped = {
      id: '1:5',
      absoluteRenderBounds: null, // hidden / clipped / off-canvas → blank export
      exportAsync: async () => new Uint8Array([0]),
    } as unknown as BaseNode;
    const visible = {
      id: '1:6',
      absoluteRenderBounds: { x: 0, y: 0, width: 10, height: 10 },
      exportAsync: async () => new Uint8Array([1, 2, 3]),
    } as unknown as BaseNode;
    const handler = createGetScreenshotHandler(
      fakeFigma({ '1:5': clipped, '1:6': visible }, calls),
    );
    const result = (await handler({ nodeIds: ['1:5', '1:6'] })) as GetScreenshotResult;
    expect(result.images[0]).toEqual({
      nodeId: '1:5',
      format: 'PNG',
      base64: 'b64(1)',
      empty: true,
    });
    // no empty flag; the tiny 10×10 node auto-fits up (×4 cap) and reports its raster size
    expect(result.images[1]).toEqual({
      nodeId: '1:6',
      format: 'PNG',
      base64: 'b64(3)',
      width: 40,
      height: 40,
      scale: 4,
    });
  });

  it('recovers a fully-clipped node via useAbsoluteBounds instead of shipping blank', async () => {
    const calls: ExportCall[] = [];
    const clippedWithBox = {
      id: '1:7',
      visible: true,
      absoluteRenderBounds: null, // clipped away on canvas → in-place export would be blank
      absoluteBoundingBox: { x: 0, y: 0, width: 150, height: 100 }, // but the art exists at its own box
      exportAsync: async (settings: ExportCall) => {
        calls.push(settings);
        return new Uint8Array([9, 9, 9, 9]);
      },
    } as unknown as BaseNode;
    const handler = createGetScreenshotHandler(fakeFigma({ '1:7': clippedWithBox }, calls));
    const result = (await handler({ nodeIds: ['1:7'] })) as GetScreenshotResult;
    // The 150×100 intrinsic box auto-fits up to the 512px legibility floor (512/150 → 3.41).
    expect(result.images[0]).toEqual({
      nodeId: '1:7',
      format: 'PNG',
      base64: 'b64(4)',
      recovered: true,
      width: 512,
      height: 341,
      scale: 3.41,
    });
    // Exported once, with useAbsoluteBounds so Figma renders the node's own box, not the clipped region.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      format: 'PNG',
      constraint: { type: 'SCALE', value: 3.41 },
      useAbsoluteBounds: true,
    });
  });

  it('does not recover an intentionally hidden node (visible:false) — stays empty', async () => {
    const calls: ExportCall[] = [];
    const hidden = {
      id: '1:8',
      visible: false,
      absoluteRenderBounds: null,
      absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 50 },
      exportAsync: async (settings: ExportCall) => {
        calls.push(settings);
        return new Uint8Array([0]);
      },
    } as unknown as BaseNode;
    const handler = createGetScreenshotHandler(fakeFigma({ '1:8': hidden }, calls));
    const result = (await handler({ nodeIds: ['1:8'] })) as GetScreenshotResult;
    // A blank isn't auto-fitted (scale stays 1); its box size is still reported for context.
    expect(result.images[0]).toEqual({
      nodeId: '1:8',
      format: 'PNG',
      base64: 'b64(1)',
      empty: true,
      width: 50,
      height: 50,
      scale: 1,
    });
    expect(calls[0]?.useAbsoluteBounds).toBeUndefined();
  });

  it('auto-fits an oversized frame down (long edge → 2576) and reports the raster size', async () => {
    const calls: ExportCall[] = [];
    const big = {
      id: '2:1',
      absoluteRenderBounds: { x: 0, y: 0, width: 4000, height: 2000 },
      exportAsync: async (settings: ExportCall) => {
        calls.push(settings);
        return new Uint8Array([7]);
      },
    } as unknown as BaseNode;
    const handler = createGetScreenshotHandler(fakeFigma({ '2:1': big }, calls));
    const result = (await handler({ nodeIds: ['2:1'] })) as GetScreenshotResult;
    // 2576/4000 = 0.644 → 0.64 at two decimals
    expect(calls[0]).toEqual({ format: 'PNG', constraint: { type: 'SCALE', value: 0.64 } });
    expect(result.images[0]).toEqual({
      nodeId: '2:1',
      format: 'PNG',
      base64: 'b64(1)',
      width: 2560,
      height: 1280,
      scale: 0.64,
    });
  });

  it('keeps a mid-size node at 1x, and honors an explicit scale over auto-fit', async () => {
    const calls: ExportCall[] = [];
    const mkNode = (id: string, width: number, height: number): BaseNode =>
      ({
        id,
        absoluteRenderBounds: { x: 0, y: 0, width, height },
        exportAsync: async (settings: ExportCall) => {
          calls.push(settings);
          return new Uint8Array([1]);
        },
      }) as unknown as BaseNode;
    const lookup = { '3:1': mkNode('3:1', 800, 600), '3:2': mkNode('3:2', 3072, 2000) };

    // 800×600 sits inside the [512, 2576] window → no fitting
    const handler = createGetScreenshotHandler(fakeFigma(lookup, calls));
    const mid = (await handler({ nodeIds: ['3:1'] })) as GetScreenshotResult;
    expect(calls[0]?.constraint).toEqual({ type: 'SCALE', value: 1 });
    expect(mid.images[0]).toMatchObject({ width: 800, height: 600, scale: 1 });

    // explicit scale wins even on an oversized node (the old behaviour stays reachable)
    const forced = (await handler({ nodeIds: ['3:2'], scale: 1 })) as GetScreenshotResult;
    expect(calls[1]?.constraint).toEqual({ type: 'SCALE', value: 1 });
    expect(forced.images[0]).toMatchObject({ width: 3072, height: 2000, scale: 1 });
  });

  it('caps an explicit scale to the vision ceiling only when forVision is set', async () => {
    const calls: ExportCall[] = [];
    const node = {
      id: '4:1',
      absoluteRenderBounds: { x: 0, y: 0, width: 1440, height: 5056 },
      exportAsync: async (settings: ExportCall) => {
        calls.push(settings);
        return new Uint8Array([1]);
      },
    } as unknown as BaseNode;
    const handler = createGetScreenshotHandler(fakeFigma({ '4:1': node }, calls));

    // Headed for a model: 4x on a 5056px-long frame would ship a 20224px raster the model
    // downsamples to 2576 anyway → capped to 2576/5056 = 0.509… → 0.51.
    const capped = (await handler({
      nodeIds: ['4:1'],
      scale: 4,
      forVision: true,
    })) as GetScreenshotResult;
    expect(calls[0]?.constraint).toEqual({ type: 'SCALE', value: 0.51 });
    expect(capped.images[0]).toMatchObject({ scale: 0.51, height: 2579 });

    // Same request headed for disk (save_screenshots omits forVision) keeps the caller's 4x.
    const full = (await handler({ nodeIds: ['4:1'], scale: 4 })) as GetScreenshotResult;
    expect(calls[1]?.constraint).toEqual({ type: 'SCALE', value: 4 });
    expect(full.images[0]).toMatchObject({ scale: 4, height: 20224 });

    // A scale already under the ceiling is untouched even with forVision on.
    await handler({ nodeIds: ['4:1'], scale: 0.25, forVision: true });
    expect(calls[2]?.constraint).toEqual({ type: 'SCALE', value: 0.25 });
  });

  it('drops the whole batch to the many-image ceiling past 20 nodes', async () => {
    const calls: ExportCall[] = [];
    const mk = (id: string): BaseNode =>
      ({
        id,
        absoluteRenderBounds: { x: 0, y: 0, width: 3000, height: 2000 },
        exportAsync: async (settings: ExportCall) => {
          calls.push(settings);
          return new Uint8Array([1]);
        },
      }) as unknown as BaseNode;
    const ids = Array.from({ length: 21 }, (_, i) => `5:${i}`);
    const lookup = Object.fromEntries(ids.map(id => [id, mk(id)]));
    const handler = createGetScreenshotHandler(fakeFigma(lookup, calls));

    // 20 nodes stay on the full ceiling: 2576/3000 → 0.86
    await handler({ nodeIds: ids.slice(0, 20), forVision: true });
    expect(calls.every(c => c.constraint?.value === 0.86)).toBe(true);

    // 21 crosses the threshold — every node in the batch drops to 2000/3000 → 0.67, or the
    // provider rejects the entire request.
    calls.length = 0;
    await handler({ nodeIds: ids, forVision: true });
    expect(calls).toHaveLength(21);
    expect(calls.every(c => c.constraint?.value === 0.67)).toBe(true);

    // An explicit scale in a big batch is capped to the same stricter ceiling.
    calls.length = 0;
    await handler({ nodeIds: ids, scale: 4, forVision: true });
    expect(calls.every(c => c.constraint?.value === 0.67)).toBe(true);

    // Disk exports never reach a provider, so the batch size is irrelevant there.
    calls.length = 0;
    await handler({ nodeIds: ids, scale: 4 });
    expect(calls.every(c => c.constraint?.value === 4)).toBe(true);
  });

  it('throws on empty/invalid nodeIds, bad format, or non-positive scale', async () => {
    const handler = createGetScreenshotHandler(fakeFigma({}));
    await expect(handler({ nodeIds: [] })).rejects.toThrow(/nodeIds/);
    await expect(handler({ nodeIds: [1] })).rejects.toThrow(/nodeIds/);
    await expect(handler({ nodeIds: ['1:1'], format: 'GIF' })).rejects.toThrow(/format/);
    await expect(handler({ nodeIds: ['1:1'], scale: 0 })).rejects.toThrow(/scale/);
  });
});
