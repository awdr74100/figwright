import type { GetScreenshotResult } from '@figma-mcp-relay/shared';
import { describe, expect, it } from 'vitest';

import { createGetScreenshotHandler } from '../../src/handlers/get-screenshot.js';

interface ExportCall {
  format: string;
  constraint?: { type: string; value: number };
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
    expect(result.images[1]).toEqual({ nodeId: '1:6', format: 'PNG', base64: 'b64(3)' }); // no empty
  });

  it('throws on empty/invalid nodeIds, bad format, or non-positive scale', async () => {
    const handler = createGetScreenshotHandler(fakeFigma({}));
    await expect(handler({ nodeIds: [] })).rejects.toThrow(/nodeIds/);
    await expect(handler({ nodeIds: [1] })).rejects.toThrow(/nodeIds/);
    await expect(handler({ nodeIds: ['1:1'], format: 'GIF' })).rejects.toThrow(/format/);
    await expect(handler({ nodeIds: ['1:1'], scale: 0 })).rejects.toThrow(/scale/);
  });
});
