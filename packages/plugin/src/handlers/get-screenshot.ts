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

// Auto-fit window for the default raster scale (only when the caller omits `scale`). Vision models
// downsample anything past ~1.5k px on the long edge, so a bigger export is pure payload (and, on a
// huge frame, disconnect risk) with zero fidelity gain — while a 24px icon at 1x is illegibly small.
// Saved files are different: save_screenshots passes an explicit scale so disk artifacts stay full-res.
const TARGET_LONG_EDGE = 1536;
const MIN_LONG_EDGE = 512;
const MAX_UPSCALE = 4;

/** Fit the long edge into [MIN, TARGET]: oversized scales down, tiny scales up (capped), else 1. */
const autoFitScale = (box: { width: number; height: number }): number => {
  const long = Math.max(box.width, box.height);
  if (!(long > 0)) return 1;
  const raw =
    long > TARGET_LONG_EDGE
      ? TARGET_LONG_EDGE / long
      : Math.min(MAX_UPSCALE, Math.max(1, MIN_LONG_EDGE / long));
  // Two decimals keep the reported scale (and the export constraint) readable without moving the
  // output size by more than a few px.
  return Math.round(raw * 100) / 100;
};

/**
 * Report the raster's pixel size + effective scale so the consumer can map raster px back to design
 * px (essential once the scale is auto-fitted, and for recovered intrinsic-bounds exports).
 * Computed from bounds × scale (±1px of Figma's own rounding — advisory, not measurement). SVG
 * carries its own dimensions in the markup; unknown bounds stay unreported.
 */
const attachRasterDims = (
  image: ScreenshotImage,
  box: { width: number; height: number } | null | undefined,
  scale: number,
): void => {
  if (image.format === 'SVG' || box == null || !(box.width > 0) || !(box.height > 0)) return;
  image.width = Math.round(box.width * scale);
  image.height = Math.round(box.height * scale);
  image.scale = scale;
};

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
    // Explicit scale is honored exactly; omitted scale auto-fits per node (see autoFitScale).
    const requestedScale = typeof p.scale === 'number' ? p.scale : undefined;
    // useAbsoluteBounds renders the node at its own bounding box instead of its (clipped) render
    // region — see the recovery path below. We only ever turn it on for that recovery.
    const makeSettings = (useAbsoluteBounds: boolean, scale: number): ExportSettings =>
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
          // The render bounds are what this path exports; PAGE/DOCUMENT lack them → fall back to the
          // bounding box, else give up on fitting/reporting and export at 1x like before.
          const box = geom.absoluteRenderBounds ?? geom.absoluteBoundingBox;
          const scale = requestedScale ?? (box != null ? autoFitScale(box) : 1);
          const bytes = await node.exportAsync(makeSettings(false, scale));
          const image: ScreenshotImage = { nodeId, format, base64: figmaCtx.base64Encode(bytes) };
          attachRasterDims(image, box, scale);
          return image;
        }

        // The node would export blank. If it has a real bounding box and isn't intentionally hidden, the
        // art exists — it's just clipped away by an ancestor. Re-export the SAME node with
        // useAbsoluteBounds so Figma renders its intrinsic box rather than the empty clipped region. This
        // is read-only: no clone, no document mutation, no residue. Only when there's nothing to recover
        // (hidden, or no box at all) do we fall back to flagging the blank as empty.
        const box = geom.absoluteBoundingBox;
        const recoverable =
          geom.visible !== false && box != null && box.width > 0 && box.height > 0;
        // A blank isn't worth fitting — keep it at 1x unless the caller asked for a scale.
        const scale = requestedScale ?? (recoverable ? autoFitScale(box) : 1);
        const bytes = await node.exportAsync(makeSettings(recoverable, scale));
        const image: ScreenshotImage = { nodeId, format, base64: figmaCtx.base64Encode(bytes) };
        if (recoverable) image.recovered = true;
        else image.empty = true;
        attachRasterDims(image, box, scale);
        return image;
      }),
    );

    const result: GetScreenshotResult = { images };
    return result;
  };
