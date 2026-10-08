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
    const nodes: SerializedNode[] = [];
    // A live ~30k-instance page aborts with unbounded lookups; 512 keeps each batch below the
    // size of a successful subtree read without the excessive overhead of much smaller batches.
    const batchSize = 512;
    for (let offset = 0; offset < matches.length; offset += batchSize) {
      if (offset > 0) {
        // A resolved promise only yields to microtasks, not Figma's message / timer loop.
        // eslint-disable-next-line no-await-in-loop -- let the host run between bounded batches
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      // Bound outstanding main-component lookups without truncating the flat, ordered result.
      // eslint-disable-next-line no-await-in-loop -- serialize matches in bounded batches
      const batch = await Promise.all(matches.slice(offset, offset + batchSize).map(serializeFlat));
      nodes.push(...batch);
    }
    const result: SearchNodesResult = { nodes };
    return result;
  };
