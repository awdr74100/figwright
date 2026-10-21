import type { MutateResult, SerializedPaint } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { toFigmaPaintsBound } from './bindings.js';
import { toDocumentRgb, toDocumentRgba } from './convert.js';
import { writePaints } from './paints.js';

/**
 * Convert a serialized paint back to a Figma Paint. SOLID, the four gradient types (round-tripping
 * serializePaint's gradientStops + gradientTransform) and PATTERN are supported. IMAGE/VIDEO are
 * not writable here — set_image_fill puts an image into a fill, import_image places a new one.
 */
export const toFigmaPaint = (paint: SerializedPaint, figmaCtx: typeof figma): Paint => {
  if (paint.type === 'SOLID') {
    return {
      type: 'SOLID',
      color: toDocumentRgb(figmaCtx, paint.color, 'SOLID'),
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
        color: toDocumentRgba(figmaCtx, s.color, paint.type),
      })),
      gradientTransform: paint.gradientTransform as unknown as Transform,
      opacity: paint.opacity,
      visible: paint.visible,
    } as GradientPaint;
  }
  if (paint.type === 'PATTERN') {
    // The serializer leaves out the no-op defaults (no spacing, START alignments) and an agent may
    // too; Figma wants every field, so they are filled back in here.
    const pattern = paint as Partial<Extract<SerializedPaint, { type: 'PATTERN' }>>;
    if (typeof pattern.sourceNodeId !== 'string') {
      throw new TypeError('PATTERN: sourceNodeId (the layer to tile) is required');
    }
    return {
      type: 'PATTERN',
      sourceNodeId: pattern.sourceNodeId,
      tileType: pattern.tileType ?? 'RECTANGULAR',
      scalingFactor: pattern.scalingFactor ?? 1,
      spacing: pattern.spacing ?? { x: 0, y: 0 },
      horizontalAlignment: pattern.horizontalAlignment ?? 'START',
      verticalAlignment: pattern.verticalAlignment ?? 'START',
      opacity: paint.opacity,
      visible: paint.visible,
    } as unknown as Paint;
  }
  throw new TypeError(
    `set_fills: unsupported paint type ${paint.type} (SOLID, gradients and PATTERN) — put an ` +
      'image into a fill with set_image_fill',
  );
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
    await writePaints(
      node,
      'fills',
      await toFigmaPaintsBound(figmaCtx, p.fills as SerializedPaint[], 'set_fills'),
    );

    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
