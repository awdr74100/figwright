import type { SandboxToolHandler } from '../dispatcher.js';
import { resultCharBudget, serializeFlatNodes, toNodeListResult } from '../serializer.js';
import { collectMatches, resolveScope } from '../traverse.js';

export const createScanNodesByTypesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { types?: unknown; root?: unknown };
    if (
      !Array.isArray(p.types) ||
      p.types.length === 0 ||
      p.types.some(t => typeof t !== 'string')
    ) {
      throw new TypeError('scan_nodes_by_types: types must be a non-empty string[]');
    }
    const types = new Set(p.types as readonly string[]);
    const scope = await resolveScope(figmaCtx, p.root);

    const matches = await collectMatches(scope, node => types.has(node.type));
    return toNodeListResult(matches, await serializeFlatNodes(matches, resultCharBudget()));
  };
