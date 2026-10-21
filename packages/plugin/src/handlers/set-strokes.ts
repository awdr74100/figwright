import type { MutateResult, SerializedPaint } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { toFigmaPaintsBound } from './bindings.js';
import { writePaints } from './paints.js';

const CAPS = new Set([
  'NONE',
  'ROUND',
  'SQUARE',
  'ARROW_LINES',
  'ARROW_EQUILATERAL',
  'DIAMOND_FILLED',
  'TRIANGLE_FILLED',
  'CIRCLE_FILLED',
]);
const JOINS = new Set(['MITER', 'BEVEL', 'ROUND']);

const PER_SIDE = [
  'strokeTopWeight',
  'strokeRightWeight',
  'strokeBottomWeight',
  'strokeLeftWeight',
] as const;

export const createSetStrokesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      nodeId?: unknown;
      strokes?: unknown;
      strokeWeight?: unknown;
      strokeAlign?: unknown;
      dashPattern?: unknown;
      strokeCap?: unknown;
      strokeJoin?: unknown;
      strokeMiterLimit?: unknown;
      strokeTopWeight?: unknown;
      strokeRightWeight?: unknown;
      strokeBottomWeight?: unknown;
      strokeLeftWeight?: unknown;
    };
    if (typeof p.nodeId !== 'string') throw new TypeError('set_strokes: nodeId must be a string');
    if (!Array.isArray(p.strokes)) throw new TypeError('set_strokes: strokes must be an array');
    if (
      p.strokeWeight !== undefined &&
      (typeof p.strokeWeight !== 'number' || p.strokeWeight < 0)
    ) {
      throw new TypeError('set_strokes: strokeWeight must be a non-negative number');
    }
    if (p.dashPattern !== undefined && !Array.isArray(p.dashPattern)) {
      throw new TypeError('set_strokes: dashPattern must be an array of numbers');
    }
    // Checked here, not left to Figma: its refusal would come after the paints were written.
    if (p.strokeCap !== undefined && !CAPS.has(p.strokeCap as string)) {
      throw new TypeError(`set_strokes: strokeCap must be one of ${[...CAPS].join(', ')}`);
    }
    if (p.strokeJoin !== undefined && !JOINS.has(p.strokeJoin as string)) {
      throw new TypeError('set_strokes: strokeJoin must be MITER, BEVEL or ROUND');
    }
    if (
      p.strokeMiterLimit !== undefined &&
      (typeof p.strokeMiterLimit !== 'number' || p.strokeMiterLimit < 1 || p.strokeMiterLimit > 16)
    ) {
      throw new RangeError('set_strokes: strokeMiterLimit must be between 1 and 16');
    }
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !('strokes' in node)) {
      throw new Error(`set_strokes: node ${p.nodeId} not found or cannot have strokes`);
    }
    // Checked before any write: some stroked nodes (FigJam's shapes with text) have no line ends.
    for (const field of ['strokeCap', 'strokeMiterLimit'] as const) {
      if (p[field] !== undefined && !(field in node)) {
        throw new Error(
          `set_strokes: a ${node.type} has no ${field} — it has no line ends to shape`,
        );
      }
    }
    await writePaints(
      node,
      'strokes',
      await toFigmaPaintsBound(figmaCtx, p.strokes as SerializedPaint[], 'set_strokes'),
    );
    if (typeof p.strokeWeight === 'number') {
      (node as { strokeWeight: number }).strokeWeight = p.strokeWeight;
    }
    if (typeof p.strokeAlign === 'string') {
      (node as { strokeAlign: string }).strokeAlign = p.strokeAlign;
    }
    if (Array.isArray(p.dashPattern)) {
      (node as { dashPattern: readonly number[] }).dashPattern = p.dashPattern as number[];
    }
    if (typeof p.strokeCap === 'string') (node as { strokeCap: string }).strokeCap = p.strokeCap;
    if (typeof p.strokeJoin === 'string')
      (node as { strokeJoin: string }).strokeJoin = p.strokeJoin;
    if (typeof p.strokeMiterLimit === 'number') {
      (node as { strokeMiterLimit: number }).strokeMiterLimit = p.strokeMiterLimit;
    }
    // Per-side weights live on IndividualStrokesMixin (frames/rects/components). Set them after the
    // uniform strokeWeight so a per-side value overrides it; skip silently on nodes that lack them.
    for (const side of PER_SIDE) {
      const v = p[side];
      if (typeof v === 'number') {
        if (!(side in node)) {
          throw new Error(`set_strokes: node ${p.nodeId} does not support per-side stroke weights`);
        }
        (node as unknown as Record<string, number>)[side] = v;
      }
    }
    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
