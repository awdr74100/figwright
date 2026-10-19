import type { CreateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { resolveSharedParent } from './boolean-operation.js';

export const createFlattenNodesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeIds?: unknown; name?: unknown };
    if (
      !Array.isArray(p.nodeIds) ||
      p.nodeIds.length === 0 ||
      p.nodeIds.some(id => typeof id !== 'string')
    ) {
      throw new TypeError('flatten_nodes: nodeIds must be a non-empty string[]');
    }
    const { nodes, parent, index } = await resolveSharedParent(
      figmaCtx,
      p.nodeIds as readonly string[],
      'flatten_nodes',
    );
    const vector = figmaCtx.flatten(nodes, parent, index);
    if (typeof p.name === 'string') vector.name = p.name;

    const out: CreateResult = { ok: true, nodeId: vector.id, name: vector.name, type: vector.type };
    return out;
  };
