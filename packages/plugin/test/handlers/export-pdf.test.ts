import type { PdfExport } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createExportPdfHandler } from '../../src/handlers/export-pdf.js';

const base64Encode = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
const pdfBytes = new Uint8Array([1, 2, 3]);

describe('export_pdf handler', () => {
  it('exports the current page when no nodeId is given', async () => {
    const exportAsync = vi.fn<() => Promise<Uint8Array>>(async () => pdfBytes);
    const figmaCtx = {
      currentPage: { id: '0:1', exportAsync },
      base64Encode,
    } as unknown as typeof figma;

    const result = (await createExportPdfHandler(figmaCtx)({})) as PdfExport;

    expect(exportAsync).toHaveBeenCalledWith({ format: 'PDF' });
    expect(result).toEqual({ nodeId: '0:1', base64: Buffer.from(pdfBytes).toString('base64') });
  });

  it('exports a node by id', async () => {
    const exportAsync = vi.fn<() => Promise<Uint8Array>>(async () => pdfBytes);
    const node = {
      id: '3:21',
      exportAsync,
      absoluteRenderBounds: { x: 0, y: 0, width: 1, height: 1 },
    };
    const figmaCtx = {
      currentPage: { id: '0:1' },
      getNodeByIdAsync: async () => node,
      base64Encode,
    } as unknown as typeof figma;

    const result = (await createExportPdfHandler(figmaCtx)({ nodeId: '3:21' })) as PdfExport;
    expect(result).toEqual({ nodeId: '3:21', base64: Buffer.from(pdfBytes).toString('base64') });
  });

  it('returns base64 null for a missing / non-exportable node', async () => {
    const figmaCtx = {
      currentPage: { id: '0:1' },
      getNodeByIdAsync: async () => null,
      base64Encode,
    } as unknown as typeof figma;

    const result = (await createExportPdfHandler(figmaCtx)({ nodeId: '9:9' })) as PdfExport;
    expect(result).toEqual({ nodeId: '9:9', base64: null });
  });

  it('flags empty when the node rendered nothing', async () => {
    const node = { id: '5:5', exportAsync: async () => pdfBytes, absoluteRenderBounds: null };
    const figmaCtx = {
      currentPage: { id: '0:1' },
      getNodeByIdAsync: async () => node,
      base64Encode,
    } as unknown as typeof figma;

    const result = (await createExportPdfHandler(figmaCtx)({ nodeId: '5:5' })) as PdfExport;
    expect(result.empty).toBe(true);
  });
});
