import type { SearchNodesResult, SerializedNode } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { serializeFlat } from '../serializer.js';
import { resolveScope, walk } from '../traverse.js';

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

    const matches: SceneNode[] = [];
    for (const node of walk(scope)) {
      if (needle !== null && !node.name.toLowerCase().includes(needle)) continue;
      if (wantType !== null && node.type !== wantType) continue;
      matches.push(node);
    }
    const nodes: SerializedNode[] = await Promise.all(matches.map(serializeFlat));
    const result: SearchNodesResult = { nodes };
    return result;
  };
