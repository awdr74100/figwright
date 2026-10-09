import type { ScanTextNodesResult, SerializedNode } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { serializeFlatNodes } from '../serializer.js';
import { resolveScope, walkCooperatively } from '../traverse.js';

export const createScanTextNodesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const root = (params as { root?: unknown } | null)?.root;
    const scope = await resolveScope(figmaCtx, root);

    const matches: SceneNode[] = [];
    for await (const node of walkCooperatively(scope)) {
      if (node.type === 'TEXT') matches.push(node);
    }
    const nodes: SerializedNode[] = await serializeFlatNodes(matches);
    const result: ScanTextNodesResult = { nodes };
    return result;
  };
