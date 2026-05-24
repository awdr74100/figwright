import type { MutateResult, SerializedPaint } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/** Convert a serialized paint back to a Figma Paint. Only SOLID is supported for writes so far. */
export const toFigmaPaint = (paint: SerializedPaint): Paint => {
  if (paint.type !== 'SOLID') {
    throw new TypeError(`set_fills: only SOLID paints are supported (got ${paint.type})`);
  }
  return {
    type: 'SOLID',
    color: { r: paint.color.r, g: paint.color.g, b: paint.color.b },
    opacity: paint.opacity,
    visible: paint.visible,
  };
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
