import type { GetNodeResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { serializeTree } from '../serializer.js';

const isSceneNode = (node: BaseNode): node is SceneNode =>
  node.type !== 'DOCUMENT' && node.type !== 'PAGE';

export const createGetNodeHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const nodeId = (params as { nodeId?: unknown } | null)?.nodeId;
    if (typeof nodeId !== 'string') {
      throw new TypeError('get_node: nodeId must be a string');
    }
    const node = await figmaCtx.getNodeByIdAsync(nodeId);
    const result: GetNodeResult = {
      node: node !== null && isSceneNode(node) ? await serializeTree(node) : null,
    };
    return result;
  };
