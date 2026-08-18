import type { ImageFillBytes, ImageFillsResult, NodeImageFills } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/** The wire payload + intrinsic size for one resolved image hash. */
interface ResolvedImage {
  payload: Pick<ImageFillBytes, 'base64' | 'bytes'>;
  width: number;
  height: number;
}

/**
 * Extract the ORIGINAL bytes behind each node's IMAGE fills via getImageByHash().getBytesAsync() —
 * the asset as uploaded, with no mask / clip / crop / scale / effects applied (that is what
 * get_screenshot's exportAsync bakes in). Read-only: reading image bytes never mutates the
 * document.
 *
 * The same imageHash (a logo reused across many nodes) is fetched exactly once per call — the byte
 * fetch + size lookup is memoized by hash, so a design that repeats one asset doesn't re-download
 * it N times.
 */
/** One fill's result entry — at module scope so the map callback stays spread-free. */
const fillEntry = (
  index: number,
  imageHash: string,
  data: ResolvedImage,
  scaleMode: string,
): ImageFillBytes => ({
  index,
  imageHash,
  ...data.payload,
  width: data.width,
  height: data.height,
  scaleMode,
});

export const createSaveImageFillsHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeIds?: unknown; binary?: unknown };
    if (
      !Array.isArray(p.nodeIds) ||
      p.nodeIds.length === 0 ||
      p.nodeIds.some(id => typeof id !== 'string')
    ) {
      throw new TypeError('save_image_fills: nodeIds must be a non-empty string[]');
    }

    // See get_screenshot: `binary` means the server lands these bytes on disk, so they skip base64.
    const binary = p.binary === true;
    const toPayload = (bytes: Uint8Array): Pick<ImageFillBytes, 'base64' | 'bytes'> =>
      binary ? { base64: null, bytes } : { base64: figmaCtx.base64Encode(bytes) };

    const cache = new Map<string, Promise<ResolvedImage | null>>();
    const fetchImage = (hash: string): Promise<ResolvedImage | null> => {
      let pending = cache.get(hash);
      if (pending === undefined) {
        pending = (async (): Promise<ResolvedImage | null> => {
          const image = figmaCtx.getImageByHash(hash);
          if (image === null) return null;
          const [bytes, size] = await Promise.all([image.getBytesAsync(), image.getSizeAsync()]);
          // Encoded inside the memo, not per usage: a logo reused across 50 nodes must cost one
          // base64Encode, not 50. The cache is what makes that true, so the payload belongs in it.
          return { payload: toPayload(bytes), width: size.width, height: size.height };
        })();
        cache.set(hash, pending);
      }
      return pending;
    };

    const ids = p.nodeIds as readonly string[];
    const nodes: NodeImageFills[] = await Promise.all(
      ids.map(async (nodeId): Promise<NodeImageFills> => {
        const node = await figmaCtx.getNodeByIdAsync(nodeId);
        if (node === null || !('fills' in node)) return { nodeId, images: [] };

        const fills = (node as unknown as { fills: readonly Paint[] | typeof figma.mixed }).fills;
        // Mixed fills (per-text-range) can't be indexed as an array — flag rather than crash.
        if (fills === figmaCtx.mixed) return { nodeId, images: [], mixed: true };

        // Fetch every fill's bytes in parallel (shared hashes still resolve once via the memoized
        // cache), then drop the non-image paints — keeps fill order without an await in a loop.
        const entries = await Promise.all(
          fills.map(async (paint, index): Promise<ImageFillBytes | null> => {
            if (paint.type !== 'IMAGE') return null;
            const { scaleMode } = paint;
            const imageHash = paint.imageHash ?? null;
            if (imageHash === null) return { index, imageHash: null, base64: null, scaleMode };
            const data = await fetchImage(imageHash);
            if (data === null) return { index, imageHash, base64: null, scaleMode };
            return fillEntry(index, imageHash, data, scaleMode);
          }),
        );
        const images = entries.filter((e): e is ImageFillBytes => e !== null);
        return { nodeId, images };
      }),
    );

    const result: ImageFillsResult = { nodes };
    return result;
  };
