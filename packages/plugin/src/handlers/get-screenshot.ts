import {
  type GetScreenshotResult,
  SCREENSHOT_FORMATS,
  type ScreenshotFormat,
  type ScreenshotImage,
} from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

const isFormat = (value: unknown): value is ScreenshotFormat =>
  typeof value === 'string' && (SCREENSHOT_FORMATS as readonly string[]).includes(value);

const isExportable = (node: BaseNode): node is BaseNode & ExportMixin => 'exportAsync' in node;

export const createGetScreenshotHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeIds?: unknown; format?: unknown; scale?: unknown };
    if (
      !Array.isArray(p.nodeIds) ||
      p.nodeIds.length === 0 ||
      p.nodeIds.some(id => typeof id !== 'string')
    ) {
      throw new TypeError('get_screenshot: nodeIds must be a non-empty string[]');
    }
    if (p.format !== undefined && !isFormat(p.format)) {
      throw new TypeError(
        `get_screenshot: format must be one of ${SCREENSHOT_FORMATS.join(' / ')}`,
      );
    }
    if (p.scale !== undefined && (typeof p.scale !== 'number' || p.scale <= 0)) {
      throw new TypeError('get_screenshot: scale must be a positive number');
    }

    const format: ScreenshotFormat = isFormat(p.format) ? p.format : 'PNG';
    const scale = typeof p.scale === 'number' ? p.scale : 1;
    const settings: ExportSettings =
      format === 'SVG'
        ? { format: 'SVG' }
        : { format, constraint: { type: 'SCALE', value: scale } };

    const ids = p.nodeIds as readonly string[];
    const images: ScreenshotImage[] = await Promise.all(
      ids.map(async (nodeId): Promise<ScreenshotImage> => {
        const node = await figmaCtx.getNodeByIdAsync(nodeId);
        if (node === null || !isExportable(node)) return { nodeId, format, base64: null };
        const bytes = await node.exportAsync(settings);
        return { nodeId, format, base64: figmaCtx.base64Encode(bytes) };
      }),
    );

    const result: GetScreenshotResult = { images };
    return result;
  };
