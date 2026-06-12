import type { ScanNodesByTypesResult, SerializedNode } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { serializeFlat } from '../serializer.js';
import { resolveScope, walk } from '../traverse.js';

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

    const matches: SceneNode[] = [];
    for (const node of walk(scope)) {
      if (types.has(node.type)) matches.push(node);
    }
    const nodes: SerializedNode[] = await Promise.all(matches.map(serializeFlat));
    const result: ScanNodesByTypesResult = { nodes };
    return result;
  };
