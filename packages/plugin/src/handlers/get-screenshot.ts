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

// The long edge a vision model resolves. Past it the raster is downscaled on arrival, so the model
// sees the exact same pixels while we pay the payload and the image tokens — a 1440×5056 frame at 4x
// ships 21.5MB of base64 to be seen at 735×2579, identical to 0.51x.
//
// We can't pick this per client — MCP `initialize` carries a client *name*, and any client can be
// pointed at any model — so it has to hold for all of them at once. Per vendor docs: Claude 4.7+
// resolves 2576 (older Claude 1568); GPT downscales to 2048 at `detail: high` but honors up to 6000
// at `original`, and GPT-5.6 defaults to keeping the input size; Gemini sets no long-edge limit and
// just tiles at 768px. 2576 is the tightest *hard* ceiling among them, which makes it the right
// number: it saturates the strictest client, and the others either accept it as sent or downscale it
// themselves — nobody is left sharper by us sending more. Going past it would only serve the lenient
// clients while every client pays the payload, and would push a large frame toward the hard per-image
// byte limit.
const VISION_LONG_EDGE = 2576;
// Claude rejects the *entire* request with `invalid_request_error` when a request carries more than
// 20 images and any one of them exceeds a stricter dimension limit; GPT (1500 images) and Gemini
// (3600) publish no such rule. Screenshotting 25 frames in one call is an ordinary ask, so the batch
// steps down rather than failing. The step-down applies to every node in the batch because one
// oversized image sinks the whole request, and it applies regardless of client since we can't tell
// which one is listening — for a non-Claude client this is 22% of resolution given up on batches of
// 21+, which beats a hard failure on Claude.
const MANY_IMAGE_THRESHOLD = 20;
const MANY_IMAGE_LONG_EDGE = 2000;
const MIN_LONG_EDGE = 512;
const MAX_UPSCALE = 4;
// Floor for a computed scale: Figma rejects a 0 constraint, which rounding could otherwise produce
// on an absurdly long node.
const MIN_SCALE = 0.01;

/** Fit the long edge into [MIN, ceiling]: oversized scales down, tiny scales up (capped), else 1. */
const autoFitScale = (box: { width: number; height: number }, ceiling: number): number => {
  const long = Math.max(box.width, box.height);
  if (!(long > 0)) return 1;
  const raw =
    long > ceiling ? ceiling / long : Math.min(MAX_UPSCALE, Math.max(1, MIN_LONG_EDGE / long));
  // Two decimals keep the reported scale (and the export constraint) readable without moving the
  // output size by more than a few px.
  return Math.max(MIN_SCALE, Math.round(raw * 100) / 100);
};

/**
 * Cap an explicit scale to what the model can actually resolve. Everything past the ceiling is
 * downscaled on arrival, so the extra pixels buy no fidelity — they only inflate the payload (a
 * single image also has a hard per-request byte limit: 10MB base64 on the Claude API, 5MB on
 * Bedrock/Vertex) and the image-token bill.
 */
const capScaleForVision = (
  box: { width: number; height: number },
  scale: number,
  ceiling: number,
): number => {
  const long = Math.max(box.width, box.height);
  if (!(long > 0)) return scale;
  const maxScale = Math.max(MIN_SCALE, Math.round((ceiling / long) * 100) / 100);
  return Math.min(scale, maxScale);
};

/**
 * The scale to export at. An omitted scale auto-fits (when there's a box to fit against); an
 * explicit one is honored as asked, capped only when the raster is headed for a model.
 */
const resolveScale = (
  box: { width: number; height: number } | null | undefined,
  requested: number | undefined,
  forVision: boolean,
  fit: boolean,
  ceiling: number,
): number => {
  if (requested === undefined) return fit && box != null ? autoFitScale(box, ceiling) : 1;
  return forVision && box != null ? capScaleForVision(box, requested, ceiling) : requested;
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
    const p = (params ?? {}) as {
      nodeIds?: unknown;
      format?: unknown;
      scale?: unknown;
      forVision?: unknown;
    };
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
    // Omitted scale auto-fits per node (see autoFitScale); explicit scale is honored, capped only
    // when forVision says the raster is going into a model's context (see resolveScale).
    const requestedScale = typeof p.scale === 'number' ? p.scale : undefined;
    // Set by the get_screenshot tool path, which inlines the raster into the model's context.
    // save_screenshots leaves it off: those bytes go to disk, never to a model, so the caller's
    // scale is kept exactly and files stay full-res.
    const forVision = p.forVision === true;
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
    // A batch past the many-image threshold has to clear the stricter per-image limit or the provider
    // rejects the whole request — so the ceiling drops for every node in that batch, not just the
    // oversized ones. Disk exports aren't sent to a provider, so they keep the full ceiling.
    const ceiling =
      forVision && ids.length > MANY_IMAGE_THRESHOLD ? MANY_IMAGE_LONG_EDGE : VISION_LONG_EDGE;
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
          const scale = resolveScale(box, requestedScale, forVision, true, ceiling);
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
        const scale = resolveScale(box, requestedScale, forVision, recoverable, ceiling);
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
