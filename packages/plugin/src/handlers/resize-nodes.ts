import type { BatchNodeResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/** Resize every target node to the same width/height. Non-resizable nodes are skipped. */
export const createResizeNodesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeIds?: unknown; width?: unknown; height?: unknown };
    if (!Array.isArray(p.nodeIds) || p.nodeIds.some(id => typeof id !== 'string')) {
      throw new TypeError('resize_nodes: nodeIds must be a string[]');
    }
    if (
      typeof p.width !== 'number' ||
      typeof p.height !== 'number' ||
      p.width <= 0 ||
      p.height <= 0
    ) {
      throw new TypeError('resize_nodes: width and height must be positive numbers');
    }
    const { width, height } = p;
    const ids = p.nodeIds as readonly string[];
    const nodes = await Promise.all(ids.map(id => figmaCtx.getNodeByIdAsync(id)));

    const affected: string[] = [];
    nodes.forEach((node, i) => {
      if (node === null || typeof (node as { resize?: unknown }).resize !== 'function') return;
      (node as { resize: (w: number, h: number) => void }).resize(width, height);
      affected.push(ids[i]!);
    });

    const result: BatchNodeResult = { ok: true, affected };
    return result;
  };
