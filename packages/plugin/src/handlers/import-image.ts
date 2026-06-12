import type { CreateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { placeNode } from './place.js';

const SCALE_MODES = ['FILL', 'FIT', 'CROP', 'TILE'] as const;
type ScaleMode = (typeof SCALE_MODES)[number];

/**
 * Import an image and place it as a rectangle with an IMAGE fill. Source is either base64 `data`
 * (decoded with figma.base64Decode) or a `url` (fetched via createImageAsync — manifest allows it).
 * The rectangle defaults to the image's intrinsic size unless width/height are given.
 */
export const createImportImageHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      data?: unknown;
      url?: unknown;
      name?: unknown;
      parentId?: unknown;
      x?: unknown;
      y?: unknown;
      width?: unknown;
      height?: unknown;
      scaleMode?: unknown;
    };
    if (typeof p.data !== 'string' && typeof p.url !== 'string') {
      throw new TypeError('import_image: provide data (base64) or url');
    }
    const scaleMode: ScaleMode = SCALE_MODES.includes(p.scaleMode as ScaleMode)
      ? (p.scaleMode as ScaleMode)
      : 'FILL';

    const image =
      typeof p.data === 'string'
        ? figmaCtx.createImage(figmaCtx.base64Decode(p.data))
        : await figmaCtx.createImageAsync(p.url as string);
    const size = await image.getSizeAsync();

    const rect = figmaCtx.createRectangle();
    if (typeof p.name === 'string') rect.name = p.name;
    rect.resize(
      typeof p.width === 'number' ? p.width : size.width,
      typeof p.height === 'number' ? p.height : size.height,
    );
    if (typeof p.x === 'number') rect.x = p.x;
    if (typeof p.y === 'number') rect.y = p.y;
    rect.fills = [{ type: 'IMAGE', scaleMode, imageHash: image.hash }];

    await placeNode(figmaCtx, rect, p.parentId, 'import_image');

    const result: CreateResult = { ok: true, nodeId: rect.id, name: rect.name, type: rect.type };
    return result;
  };
