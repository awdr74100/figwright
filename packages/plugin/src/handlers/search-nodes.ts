import type { SandboxToolHandler } from '../dispatcher.js';
import { resultCharBudget, serializeFlatNodes, toNodeListResult } from '../serializer.js';
import { collectMatches, resolveScope } from '../traverse.js';

export const createSearchNodesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { name?: unknown; type?: unknown; root?: unknown };
    if (p.name !== undefined && typeof p.name !== 'string') {
      throw new TypeError('search_nodes: name must be a string');
    }
    if (p.type !== undefined && typeof p.type !== 'string') {
      throw new TypeError('search_nodes: type must be a string');
    }
    if (p.name === undefined && p.type === undefined) {
      throw new TypeError('search_nodes: at least one of name or type is required');
    }

    const needle = typeof p.name === 'string' ? p.name.toLowerCase() : null;
    const wantType = typeof p.type === 'string' ? p.type : null;
    const scope = await resolveScope(figmaCtx, p.root);

    // Type first: `name` is a native getter, and a node the type already excludes need not pay it.
    const matches = await collectMatches(
      scope,
      node =>
        (wantType === null || node.type === wantType) &&
        (needle === null || node.name.toLowerCase().includes(needle)),
    );
    return toNodeListResult(matches, await serializeFlatNodes(matches, resultCharBudget()));
  };
