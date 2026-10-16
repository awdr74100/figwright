import type { CreateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { documentColorProfile } from './color-profile.js';
import { toDocumentRgb } from './convert.js';
import { placeNode } from './place.js';

// Every imported colour goes through the one wire → document conversion, as sRGB.
const fromSrgb = (figmaCtx: typeof figma, c: RGB): RGB =>
  toDocumentRgb(figmaCtx, { r: c.r, g: c.g, b: c.b, space: 'SRGB' }, 'import_svg');

const paintFromSrgb = (figmaCtx: typeof figma, paint: Paint): Paint => {
  if (paint.type === 'SOLID') return { ...paint, color: fromSrgb(figmaCtx, paint.color) };
  if ('gradientStops' in paint) {
    return {
      ...paint,
      gradientStops: paint.gradientStops.map(stop => ({
        ...stop,
        color: { ...fromSrgb(figmaCtx, stop.color), a: stop.color.a },
      })),
    };
  }
  return paint;
};

const effectFromSrgb = (figmaCtx: typeof figma, effect: Effect): Effect =>
  effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW'
    ? { ...effect, color: { ...fromSrgb(figmaCtx, effect.color), a: effect.color.a } }
    : effect;

/**
 * An SVG's colours are CSS colours, so sRGB, but createNodeFromSvg stores their channels unchanged
 * — measured in a Display P3 file, `fill="#CC6633"` came in as P3 0.8 / 0.4 / 0.2, a visibly more
 * saturated orange than the markup draws. In a P3 file, hand every imported colour to Figma's
 * conversion so the vectors paint what the SVG does; an sRGB file already reads them as sRGB. Text
 * whose runs carry different fills (`figma.mixed`) is left as it came in.
 */
const svgColorsToDocument = (figmaCtx: typeof figma, root: FrameNode): void => {
  if (documentColorProfile(figmaCtx) !== 'DISPLAY_P3') return;
  for (const node of [root, ...root.findAll()]) {
    if ('fills' in node && Array.isArray(node.fills)) {
      node.fills = (node.fills as readonly Paint[]).map(p => paintFromSrgb(figmaCtx, p));
    }
    if ('strokes' in node && Array.isArray(node.strokes)) {
      node.strokes = node.strokes.map(p => paintFromSrgb(figmaCtx, p));
    }
    if ('effects' in node && node.effects.length > 0) {
      node.effects = node.effects.map(e => effectFromSrgb(figmaCtx, e));
    }
  }
};

/**
 * Import an SVG as editable vector nodes via createNodeFromSvg (a FrameNode of VECTOR paths), the
 * write-side mirror of codegen's icon/logo export. The frame keeps the SVG's intrinsic size unless
 * width/height are given. Invalid markup throws from createNodeFromSvg → a clear tool error.
 */
export const createImportSvgHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      svg?: unknown;
      name?: unknown;
      parentId?: unknown;
      x?: unknown;
      y?: unknown;
      width?: unknown;
      height?: unknown;
    };
    if (typeof p.svg !== 'string' || p.svg.trim() === '') {
      throw new TypeError('import_svg: svg must be a non-empty SVG markup string');
    }

    const node = figmaCtx.createNodeFromSvg(p.svg);
    svgColorsToDocument(figmaCtx, node);
    if (typeof p.name === 'string') node.name = p.name;
    if (typeof p.width === 'number' || typeof p.height === 'number') {
      node.resize(
        typeof p.width === 'number' ? p.width : node.width,
        typeof p.height === 'number' ? p.height : node.height,
      );
    }
    if (typeof p.x === 'number') node.x = p.x;
    if (typeof p.y === 'number') node.y = p.y;

    await placeNode(figmaCtx, node, p.parentId, 'import_svg');

    const result: CreateResult = { ok: true, nodeId: node.id, name: node.name, type: node.type };
    return result;
  };
