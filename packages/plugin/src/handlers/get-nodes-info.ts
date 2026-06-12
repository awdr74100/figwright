import type { GetNodesInfoResult, SerializedNode } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { serializeTree } from '../serializer.js';

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
        return node !== null && isSceneNode(node) ? await serializeTree(node) : null;
      }),
    );
    const result: GetNodesInfoResult = { nodes };
    return result;
  };
