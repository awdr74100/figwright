import type { BatchNodeResult } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/** Rename multiple nodes from a [{ nodeId, name }] list. Missing / malformed entries are skipped. */
export const createBatchRenameNodesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { renames?: unknown };
    if (!Array.isArray(p.renames))
      throw new TypeError('batch_rename_nodes: renames must be an array');
    const valid = (p.renames as { nodeId?: unknown; name?: unknown }[]).filter(
      (r): r is { nodeId: string; name: string } =>
        typeof r?.nodeId === 'string' && typeof r.name === 'string',
    );
    const nodes = await Promise.all(valid.map(r => figmaCtx.getNodeByIdAsync(r.nodeId)));

    const affected: string[] = [];
    nodes.forEach((node, i) => {
      if (node === null) return;
      node.name = valid[i]!.name;
      affected.push(valid[i]!.nodeId);
    });

    const result: BatchNodeResult = { ok: true, affected };
    return result;
  };
