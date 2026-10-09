import {
  type GetNodesInfoResult,
  type SerializedNode,
  TOOL_RESULT_BUDGET_BYTES,
} from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { serializeTrees, treeTooLargeError } from '../serializer.js';

const isSceneNode = (node: BaseNode): node is SceneNode =>
  node.type !== 'DOCUMENT' && node.type !== 'PAGE';

export const createGetNodesInfoHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const nodeIds = (params as { nodeIds?: unknown } | null)?.nodeIds;
    if (!Array.isArray(nodeIds) || nodeIds.some(id => typeof id !== 'string')) {
      throw new TypeError('get_nodes_info: nodeIds must be a string[]');
    }
    const ids = nodeIds as readonly string[];
    const nodes: Array<SerializedNode | null> = await Promise.all(
      ids.map(async id => {
        const node = await figmaCtx.getNodeByIdAsync(id);
        if (node === null || !isSceneNode(node)) return null;
        // Each tree is held to the whole budget: one that alone cannot fit can never be returned,
        // so it is refused here. Several that fit apart but not together are the server's to catch.
        const run = await serializeTrees([node], TOOL_RESULT_BUDGET_BYTES);
        if (!run.complete) throw treeTooLargeError(`get_nodes_info (${id})`, run.total);
        return run.nodes[0]!;
      }),
    );
    const result: GetNodesInfoResult = { nodes };
    return result;
  };
