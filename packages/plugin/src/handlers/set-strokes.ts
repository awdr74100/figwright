import type { MutateResult, SerializedPaint } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { toFigmaPaint } from './set-fills.js';

export const createSetStrokesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown; strokes?: unknown; strokeWeight?: unknown };
    if (typeof p.nodeId !== 'string') throw new TypeError('set_strokes: nodeId must be a string');
    if (!Array.isArray(p.strokes)) throw new TypeError('set_strokes: strokes must be an array');
    if (
      p.strokeWeight !== undefined &&
      (typeof p.strokeWeight !== 'number' || p.strokeWeight < 0)
    ) {
      throw new TypeError('set_strokes: strokeWeight must be a non-negative number');
    }
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !('strokes' in node)) {
      throw new Error(`set_strokes: node ${p.nodeId} not found or cannot have strokes`);
    }
    (node as GeometryMixin).strokes = (p.strokes as SerializedPaint[]).map(toFigmaPaint);
    if (typeof p.strokeWeight === 'number') {
      (node as { strokeWeight: number }).strokeWeight = p.strokeWeight;
    }
    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
