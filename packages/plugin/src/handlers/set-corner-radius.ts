import type { MutateResult } from '@figwright/shared';

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
      cornerSmoothing?: unknown;
      topLeftRadius?: unknown;
      topRightRadius?: unknown;
      bottomRightRadius?: unknown;
      bottomLeftRadius?: unknown;
    };
    if (typeof p.nodeId !== 'string')
      throw new TypeError('set_corner_radius: nodeId must be a string');
    if (
      p.cornerSmoothing !== undefined &&
      (typeof p.cornerSmoothing !== 'number' ||
        !Number.isFinite(p.cornerSmoothing) ||
        p.cornerSmoothing < 0 ||
        p.cornerSmoothing > 1)
    ) {
      throw new TypeError(
        'set_corner_radius: cornerSmoothing must be a finite number between 0 and 1',
      );
    }
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
    if (typeof p.radius !== 'number' && corners.length === 0 && p.cornerSmoothing === undefined) {
      throw new TypeError('set_corner_radius: provide radius, a corner radius or cornerSmoothing');
    }
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !('cornerRadius' in node)) {
      throw new Error(`set_corner_radius: node ${p.nodeId} not found or has no cornerRadius`);
    }
    if (p.cornerSmoothing !== undefined && !('cornerSmoothing' in node)) {
      throw new Error(`set_corner_radius: node ${p.nodeId} does not support cornerSmoothing`);
    }
    // Check all requested properties before writing any of them.
    for (const c of corners) {
      if (!(c in node)) {
        throw new Error(`set_corner_radius: node ${p.nodeId} does not support per-corner radii`);
      }
    }
    if (typeof p.radius === 'number') (node as { cornerRadius: number }).cornerRadius = p.radius;
    // Per-corner values override the uniform radius; smoothing leaves existing radii unchanged.
    for (const c of corners) (node as unknown as Record<string, number>)[c] = p[c] as number;
    if (typeof p.cornerSmoothing === 'number') {
      (node as { cornerSmoothing: number }).cornerSmoothing = p.cornerSmoothing;
    }
    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
