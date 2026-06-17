import {
  type GetScreenshotResult,
  SCREENSHOT_FORMATS,
  type ScreenshotFormat,
  type ScreenshotImage,
} from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

const isFormat = (value: unknown): value is ScreenshotFormat =>
  typeof value === 'string' && (SCREENSHOT_FORMATS as readonly string[]).includes(value);

const isExportable = (node: BaseNode): node is BaseNode & ExportMixin => 'exportAsync' in node;

/**
 * Geometry/visibility we read off a node to decide whether a blank in-place export can be
 * recovered.
 */
interface ClipGeometry {
  absoluteRenderBounds?: { width: number; height: number } | null;
  absoluteBoundingBox?: { width: number; height: number } | null;
  visible?: boolean;
}

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
    // useAbsoluteBounds renders the node at its own bounding box instead of its (clipped) render
    // region — see the recovery path below. We only ever turn it on for that recovery.
    const makeSettings = (useAbsoluteBounds: boolean): ExportSettings =>
      format === 'SVG'
        ? { format: 'SVG', ...(useAbsoluteBounds ? { useAbsoluteBounds } : {}) }
        : {
            format,
            constraint: { type: 'SCALE', value: scale },
            ...(useAbsoluteBounds ? { useAbsoluteBounds } : {}),
          };

    const ids = p.nodeIds as readonly string[];
    const images: ScreenshotImage[] = await Promise.all(
      ids.map(async (nodeId): Promise<ScreenshotImage> => {
        const node = await figmaCtx.getNodeByIdAsync(nodeId);
        if (node === null || !isExportable(node)) return { nodeId, format, base64: null };

        const geom = node as unknown as ClipGeometry;

        // absoluteRenderBounds is null only when the node renders nothing *as composed on the canvas* —
        // hidden, genuinely empty, or fully clipped / off-canvas (carousels, masks, off-screen states).
        // Anything else takes the normal path, which is also the only one that keeps overflowing effects
        // (drop shadows, blur) intact. PAGE/DOCUMENT lack the property → undefined, never null.
        if (geom.absoluteRenderBounds !== null) {
          const bytes = await node.exportAsync(makeSettings(false));
          return { nodeId, format, base64: figmaCtx.base64Encode(bytes) };
        }

        // The node would export blank. If it has a real bounding box and isn't intentionally hidden, the
        // art exists — it's just clipped away by an ancestor. Re-export the SAME node with
        // useAbsoluteBounds so Figma renders its intrinsic box rather than the empty clipped region. This
        // is read-only: no clone, no document mutation, no residue. Only when there's nothing to recover
        // (hidden, or no box at all) do we fall back to flagging the blank as empty.
        const box = geom.absoluteBoundingBox;
        const recoverable =
          geom.visible !== false && box != null && box.width > 0 && box.height > 0;
        const bytes = await node.exportAsync(makeSettings(recoverable));
        const image: ScreenshotImage = { nodeId, format, base64: figmaCtx.base64Encode(bytes) };
        if (recoverable) image.recovered = true;
        else image.empty = true;
        return image;
      }),
    );

    const result: GetScreenshotResult = { images };
    return result;
  };
