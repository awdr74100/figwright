import type { MutateResult } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

const PER_CORNER = [
  'topLeftRadius',
  'topRightRadius',
  'bottomRightRadius',
  'bottomLeftRadius',
] as const;

export const createSetCornerRadiusHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      nodeId?: unknown;
      radius?: unknown;
      topLeftRadius?: unknown;
      topRightRadius?: unknown;
      bottomRightRadius?: unknown;
      bottomLeftRadius?: unknown;
    };
    if (typeof p.nodeId !== 'string')
      throw new TypeError('set_corner_radius: nodeId must be a string');
    if (p.radius !== undefined && (typeof p.radius !== 'number' || p.radius < 0)) {
      throw new TypeError('set_corner_radius: radius must be a non-negative number');
    }
    const corners = PER_CORNER.filter(c => p[c] !== undefined);
    for (const c of corners) {
      const v = p[c];
      if (typeof v !== 'number' || v < 0) {
        throw new TypeError(`set_corner_radius: ${c} must be a non-negative number`);
      }
    }
    if (typeof p.radius !== 'number' && corners.length === 0) {
      throw new TypeError('set_corner_radius: provide radius or at least one corner radius');
    }
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !('cornerRadius' in node)) {
      throw new Error(`set_corner_radius: node ${p.nodeId} not found or has no cornerRadius`);
    }
    if (typeof p.radius === 'number') (node as { cornerRadius: number }).cornerRadius = p.radius;
    // Per-corner radii live on RectangleCornerMixin (rects/frames/components/instances). Set them
    // after the uniform radius so a per-corner value overrides it; reject nodes that lack them.
    for (const c of corners) {
      if (!(c in node)) {
        throw new Error(`set_corner_radius: node ${p.nodeId} does not support per-corner radii`);
      }
      (node as unknown as Record<string, number>)[c] = p[c] as number;
    }
    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
