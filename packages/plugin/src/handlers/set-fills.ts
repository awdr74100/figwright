import type { MutateResult, SerializedPaint } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/**
 * Convert a serialized paint back to a Figma Paint. SOLID and the four gradient types are supported
 * (gradients round-trip serializePaint's gradientStops + gradientTransform). IMAGE/VIDEO/PATTERN
 * are not writable here — use import_image for raster fills.
 */
export const toFigmaPaint = (paint: SerializedPaint): Paint => {
  if (paint.type === 'SOLID') {
    return {
      type: 'SOLID',
      color: { r: paint.color.r, g: paint.color.g, b: paint.color.b },
      opacity: paint.opacity,
      visible: paint.visible,
    };
  }
  if (
    paint.type === 'GRADIENT_LINEAR' ||
    paint.type === 'GRADIENT_RADIAL' ||
    paint.type === 'GRADIENT_ANGULAR' ||
    paint.type === 'GRADIENT_DIAMOND'
  ) {
    if (!Array.isArray(paint.gradientStops) || paint.gradientStops.length === 0) {
      throw new TypeError(`${paint.type}: gradientStops must be a non-empty array`);
    }
    if (!Array.isArray(paint.gradientTransform) || paint.gradientTransform.length !== 2) {
      throw new TypeError(`${paint.type}: gradientTransform must be a 2×3 matrix`);
    }
    return {
      type: paint.type,
      gradientStops: paint.gradientStops.map(s => ({
        position: s.position,
        color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a },
      })),
      gradientTransform: paint.gradientTransform as unknown as Transform,
      opacity: paint.opacity,
      visible: paint.visible,
    } as GradientPaint;
  }
  throw new TypeError(`set_fills: unsupported paint type ${paint.type} (SOLID + gradients only)`);
};

export const createSetFillsHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown; fills?: unknown };
    if (typeof p.nodeId !== 'string') throw new TypeError('set_fills: nodeId must be a string');
    if (!Array.isArray(p.fills)) throw new TypeError('set_fills: fills must be an array');

    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !('fills' in node)) {
      throw new Error(`set_fills: node ${p.nodeId} not found or cannot have fills`);
    }
    (node as GeometryMixin).fills = (p.fills as SerializedPaint[]).map(toFigmaPaint);

    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
