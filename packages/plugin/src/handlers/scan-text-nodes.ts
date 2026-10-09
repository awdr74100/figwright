import type { ScanTextNodesResult, SerializedNode } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { serializeFlatNodes } from '../serializer.js';
import { resolveScope, walk } from '../traverse.js';

export const createScanTextNodesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const root = (params as { root?: unknown } | null)?.root;
    const scope = await resolveScope(figmaCtx, root);

    const matches: SceneNode[] = [];
    for (const node of walk(scope)) {
      if (node.type === 'TEXT') matches.push(node);
    }
    const nodes: SerializedNode[] = await serializeFlatNodes(matches);
    const result: ScanTextNodesResult = { nodes };
    return result;
  };
