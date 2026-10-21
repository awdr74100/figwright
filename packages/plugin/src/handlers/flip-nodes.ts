import type { BatchNodeResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/**
 * A node's transform mirrored on the canvas about its own centre. The plugin API has no flip, so
 * the transform is rewritten: the axis's row of the matrix changes sign, and the translation moves
 * so the centre (the matrix applied to half the size) stays put.
 */
export const flipped = (
  [[a, c, e], [b, d, f]]: Transform,
  width: number,
  height: number,
  axis: 'HORIZONTAL' | 'VERTICAL',
): Transform => {
  const cx = (a * width) / 2 + (c * height) / 2 + e;
  const cy = (b * width) / 2 + (d * height) / 2 + f;
  return axis === 'HORIZONTAL'
    ? [
        [-a, -c, cx + (a * width) / 2 + (c * height) / 2],
        [b, d, f],
      ]
    : [
        [a, c, e],
        [-b, -d, cy + (b * width) / 2 + (d * height) / 2],
      ];
};

export const createFlipNodesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeIds?: unknown; axis?: unknown };
    if (!Array.isArray(p.nodeIds) || p.nodeIds.some(id => typeof id !== 'string')) {
      throw new TypeError('flip_nodes: nodeIds must be a string[]');
    }
    if (p.axis !== 'HORIZONTAL' && p.axis !== 'VERTICAL') {
      throw new TypeError('flip_nodes: axis must be HORIZONTAL or VERTICAL');
    }
    const axis = p.axis;
    const ids = p.nodeIds as readonly string[];
    const nodes = await Promise.all(ids.map(id => figmaCtx.getNodeByIdAsync(id)));
    const missing = ids.filter(
      (_id, i) => nodes[i] === null || !('relativeTransform' in nodes[i]!),
    );
    if (missing.length > 0) {
      throw new Error(`flip_nodes: ${missing.join(', ')} not found or cannot be flipped`);
    }
    // Checked before any flip: Figma refuses a layer's transform inside an instance, and would do
    // so only after the nodes listed before it had been flipped.
    const inInstance = ids.filter(id => id.startsWith('I'));
    if (inInstance.length > 0) {
      throw new Error(
        `flip_nodes: ${inInstance.join(', ')} ${inInstance.length === 1 ? 'is' : 'are'} inside an ` +
          'instance, which cannot override a layer’s transform — flip the instance itself, or the ' +
          'layer in its main component',
      );
    }
    for (const node of nodes as SceneNode[]) {
      node.relativeTransform = flipped(node.relativeTransform, node.width, node.height, axis);
    }
    const result: BatchNodeResult = { ok: true, affected: [...ids] };
    return result;
  };
