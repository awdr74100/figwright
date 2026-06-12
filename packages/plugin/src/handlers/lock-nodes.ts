import type { BatchNodeResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

const TOOL = (locked: boolean): string => (locked ? 'lock_nodes' : 'unlock_nodes');

/** Shared lock/unlock: set `locked` on each target node. Backs both lock_nodes and unlock_nodes. */
export const createSetLockedHandler =
  (figmaCtx: typeof figma, locked: boolean): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeIds?: unknown };
    if (!Array.isArray(p.nodeIds) || p.nodeIds.some(id => typeof id !== 'string')) {
      throw new TypeError(`${TOOL(locked)}: nodeIds must be a string[]`);
    }
    const ids = p.nodeIds as readonly string[];
    const nodes = await Promise.all(ids.map(id => figmaCtx.getNodeByIdAsync(id)));

    const affected: string[] = [];
    nodes.forEach((node, i) => {
      if (node === null || !('locked' in node)) return;
      (node as { locked: boolean }).locked = locked;
      affected.push(ids[i]!);
    });

    const result: BatchNodeResult = { ok: true, affected };
    return result;
  };
