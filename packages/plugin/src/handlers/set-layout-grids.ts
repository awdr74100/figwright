import type { MutateResult, SerializedLayoutGrid } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { toFigmaLayoutGridsBound } from './bindings.js';

/**
 * Replace a frame's own layout grids (its responsive column/row scaffold) — the mirror of the
 * `layoutGrids` read field. Distinct from auto-layout: this is the visual grid overlaid on the
 * frame (the 12-col system, the 8pt baseline), not the arrangement of children. Only BaseFrameMixin
 * nodes (FRAME / COMPONENT / COMPONENT_SET / INSTANCE) carry `layoutGrids`. Passing `[]` clears
 * them.
 */
export const createSetLayoutGridsHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown; grids?: unknown };
    if (typeof p.nodeId !== 'string') {
      throw new TypeError('set_layout_grids: nodeId must be a string');
    }
    if (!Array.isArray(p.grids)) {
      throw new TypeError('set_layout_grids: grids must be an array');
    }

    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !('layoutGrids' in node)) {
      throw new Error(
        `set_layout_grids: node ${p.nodeId} not found or does not support layout grids`,
      );
    }

    (node as BaseFrameMixin).layoutGrids = await toFigmaLayoutGridsBound(
      figmaCtx,
      p.grids as SerializedLayoutGrid[],
      'set_layout_grids',
    );

    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
