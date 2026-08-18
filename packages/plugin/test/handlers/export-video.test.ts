import type { VideoExport } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createExportVideoHandler } from '../../src/handlers/export-video.js';

const videoBytes = new Uint8Array([0x00, 0x00, 0x00, 0x18]);
const base64Encode = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

/** A node whose getTopLevelFrame() resolves to an exportable frame. */
const animatedNode = (
  frameId: string,
  exportAsync: (settings: unknown) => Promise<Uint8Array>,
): unknown => ({
  id: frameId,
  getTopLevelFrame: () => ({ id: frameId, exportAsync }),
});

const makeFigma = (nodes: Record<string, unknown>, editorType = 'figma'): typeof figma =>
  ({
    editorType,
    base64Encode,
    getNodeByIdAsync: async (id: string) => nodes[id] ?? null,
  }) as unknown as typeof figma;

describe('export_video handler', () => {
  it('exports the enclosing top-level frame to base64 by default', async () => {
    const exportAsync = vi.fn<() => Promise<Uint8Array>>(async () => videoBytes);
    const f = makeFigma({ '5:5': animatedNode('5:5', exportAsync) });

    const result = (await createExportVideoHandler(f)({
      nodeId: '5:5',
      format: 'MP4',
    })) as VideoExport;

    expect(result).toEqual({ nodeId: '5:5', format: 'MP4', base64: base64Encode(videoBytes) });
    expect(exportAsync).toHaveBeenCalledWith({ format: 'MP4' });
  });

  it('returns raw bytes instead of base64 when the server asks for binary', async () => {
    const base64Spy = vi.fn<(bytes: Uint8Array) => string>(base64Encode);
    const f = {
      ...makeFigma({ '5:5': animatedNode('5:5', async () => videoBytes) }),
      base64Encode: base64Spy,
    } as unknown as typeof figma;

    const result = (await createExportVideoHandler(f)({
      nodeId: '5:5',
      format: 'MP4',
      binary: true,
    })) as VideoExport;

    expect(result).toEqual({ nodeId: '5:5', format: 'MP4', base64: null, bytes: videoBytes });
    expect(base64Spy).not.toHaveBeenCalled();
  });

  it('carries fps / quality / constraint into the export settings', async () => {
    const exportAsync = vi.fn<() => Promise<Uint8Array>>(async () => videoBytes);
    const f = makeFigma({ '3:21': animatedNode('3:21', exportAsync) });

    await createExportVideoHandler(f)({
      nodeId: '3:21',
      format: 'WEBM',
      fps: 30,
      quality: 'HIGH',
      constraint: { type: 'SCALE', value: 2 },
    });

    expect(exportAsync).toHaveBeenCalledWith({
      format: 'WEBM',
      fps: 30,
      quality: 'HIGH',
      constraint: { type: 'SCALE', value: 2 },
    });
  });

  it('misses with a reason (and no bytes) outside the Figma Design editor', async () => {
    const f = makeFigma({}, 'figjam');
    const result = (await createExportVideoHandler(f)({
      nodeId: '5:5',
      format: 'MP4',
      binary: true,
    })) as VideoExport;
    expect(result).toEqual({
      nodeId: '5:5',
      format: 'MP4',
      base64: null,
      reason: 'wrong-editor',
    });
  });

  it('reports a missing node rather than throwing', async () => {
    const f = makeFigma({});
    const result = (await createExportVideoHandler(f)({
      nodeId: '9:9',
      format: 'GIF',
    })) as VideoExport;
    expect(result).toEqual({ nodeId: '9:9', format: 'GIF', base64: null, reason: 'not-found' });
  });

  it("surfaces Figma's own message when exportAsync rejects", async () => {
    const f = makeFigma({
      '5:5': animatedNode('5:5', async () => {
        throw new Error('no animation to export');
      }),
    });
    const result = (await createExportVideoHandler(f)({
      nodeId: '5:5',
      format: 'MP4',
    })) as VideoExport;
    expect(result).toEqual({
      nodeId: '5:5',
      format: 'MP4',
      base64: null,
      reason: 'failed',
      error: 'no animation to export',
    });
  });

  it('rejects a bad format up front', async () => {
    const f = makeFigma({});
    await expect(createExportVideoHandler(f)({ nodeId: '5:5', format: 'AVI' })).rejects.toThrow(
      /format must be MP4, GIF, or WEBM/,
    );
  });
});
