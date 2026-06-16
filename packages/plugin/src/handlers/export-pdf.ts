import type { PdfExport } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

const isExportable = (node: BaseNode): node is BaseNode & ExportMixin => 'exportAsync' in node;

/**
 * Export a node — or the current page when no nodeId is given — to single-page PDF bytes (base64).
 * `exportAsync` renders one page per node; it does NOT paginate a page into one-frame-per-page
 * (that is the Figma UI's "Export frames to PDF"), so true multi-page would need a server-side PDF
 * merge. Read-only: exporting doesn't mutate the document.
 */
export const createExportPdfHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown };
    if (p.nodeId !== undefined && typeof p.nodeId !== 'string') {
      throw new TypeError('export_pdf: nodeId must be a string');
    }

    const node: BaseNode | null =
      p.nodeId === undefined ? figmaCtx.currentPage : await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !isExportable(node)) {
      const miss: PdfExport = {
        nodeId: typeof p.nodeId === 'string' ? p.nodeId : '',
        base64: null,
      };
      return miss;
    }

    const bytes = await node.exportAsync({ format: 'PDF' });
    const result: PdfExport = { nodeId: node.id, base64: figmaCtx.base64Encode(bytes) };
    // A PAGE has no absoluteRenderBounds; only flag empty when the property exists and is null.
    const renderBounds = (node as { absoluteRenderBounds?: unknown }).absoluteRenderBounds;
    if (renderBounds === null) result.empty = true;
    return result;
  };
