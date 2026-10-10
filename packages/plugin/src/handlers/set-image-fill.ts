import type { ImageFillResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

const SCALE_MODES = ['FILL', 'FIT', 'CROP', 'TILE'] as const;
type ScaleMode = (typeof SCALE_MODES)[number];

/**
 * The image paint that goes at the target slot.
 *
 * Over an IMAGE fill only the image changes: its crop, filters, rotation and scale mode are the
 * designer's framing of whatever picture sits there, the way Figma's Replace image keeps them. A
 * new scale mode drops the transform and tile scale that belonged to the old one. Over any other
 * paint the slot's own visibility, opacity and blend are kept — the layer stays the layer; its
 * colour, gradient and variable bindings describe a paint that is no longer there.
 */
const paintFor = (
  replaced: Paint | undefined,
  imageHash: string,
  scaleMode: ScaleMode | undefined,
): ImagePaint => {
  if (replaced?.type === 'IMAGE') {
    if (scaleMode === undefined || scaleMode === replaced.scaleMode) {
      return { ...replaced, imageHash };
    }
    const { imageTransform: _transform, scalingFactor: _scale, ...kept } = replaced;
    return { ...kept, imageHash, scaleMode };
  }
  const paint: ImagePaint = { type: 'IMAGE', scaleMode: scaleMode ?? 'FILL', imageHash };
  if (replaced === undefined) return paint;
  return {
    ...paint,
    ...(replaced.visible !== undefined && { visible: replaced.visible }),
    ...(replaced.opacity !== undefined && { opacity: replaced.opacity }),
    ...(replaced.blendMode !== undefined && { blendMode: replaced.blendMode }),
  };
};

/**
 * Put an image into an existing node's fills. Source is base64 `data` (a `path` arrives here
 * already read into it by the server) or a `url` fetched by Figma. The image is created before the
 * node is touched, so a rejected image (over 4096px, not an image) leaves the fills as they were.
 */
export const createSetImageFillHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      nodeId?: unknown;
      data?: unknown;
      url?: unknown;
      index?: unknown;
      scaleMode?: unknown;
    };
    if (typeof p.nodeId !== 'string') {
      throw new TypeError('set_image_fill: nodeId must be a string');
    }
    if ((typeof p.data === 'string') === (typeof p.url === 'string')) {
      throw new TypeError('set_image_fill: provide exactly one of data (base64) or url');
    }
    if (p.index !== undefined && (!Number.isInteger(p.index) || (p.index as number) < 0)) {
      throw new TypeError('set_image_fill: index must be a non-negative integer');
    }
    if (p.scaleMode !== undefined && !SCALE_MODES.includes(p.scaleMode as ScaleMode)) {
      throw new TypeError(`set_image_fill: scaleMode must be one of ${SCALE_MODES.join(' / ')}`);
    }
    const index = p.index as number | undefined;
    const scaleMode = p.scaleMode as ScaleMode | undefined;

    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !('fills' in node)) {
      throw new Error(`set_image_fill: node ${p.nodeId} not found or cannot have fills`);
    }
    const target = node as SceneNode & MinimalFillsMixin;
    const fills = target.fills;
    if (fills === figmaCtx.mixed) {
      throw new Error(
        `set_image_fill: text ${p.nodeId} has different fills across its characters — give it one ` +
          'fill with set_fills first',
      );
    }
    if (index !== undefined && index >= fills.length) {
      throw new Error(
        `set_image_fill: node ${p.nodeId} has ${fills.length} fill(s), so index ${index} is out of ` +
          `range — omit index to ${fills.length === 0 ? 'add the image' : 'replace the image or add one on top'}`,
      );
    }

    const image =
      typeof p.data === 'string'
        ? figmaCtx.createImage(figmaCtx.base64Decode(p.data))
        : await figmaCtx.createImageAsync(p.url as string);
    const size = await image.getSizeAsync();

    // Without an index: the topmost IMAGE fill, or a new slot on top.
    let at = index;
    if (at === undefined) {
      const topImage = fills.map(f => f.type).lastIndexOf('IMAGE');
      at = topImage >= 0 ? topImage : fills.length;
    }
    const next = [...fills];
    next.splice(at, at < fills.length ? 1 : 0, paintFor(fills[at], image.hash, scaleMode));
    target.fills = next;

    const written = (target.fills as readonly Paint[])[at];
    if (written?.type !== 'IMAGE' || written.imageHash !== image.hash) {
      throw new Error(`set_image_fill: Figma did not keep the image in fill ${at} of ${p.nodeId}`);
    }
    const result: ImageFillResult = {
      ok: true,
      nodeId: target.id,
      index: at,
      imageHash: image.hash,
      width: size.width,
      height: size.height,
    };
    return result;
  };
