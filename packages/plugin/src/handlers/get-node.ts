import type { GetNodeResult, SerializedNode } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { resultCharBudget, serializeTrees, treeTooLargeError } from '../serializer.js';

const isSceneNode = (node: BaseNode): node is SceneNode =>
  node.type !== 'DOCUMENT' && node.type !== 'PAGE';

const serializeWithin = async (node: SceneNode): Promise<SerializedNode> => {
  const run = await serializeTrees([node], resultCharBudget());
  if (!run.complete) throw treeTooLargeError('get_node', run.total);
  return run.nodes[0]!;
};

export const createGetNodeHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const nodeId = (params as { nodeId?: unknown } | null)?.nodeId;
    if (typeof nodeId !== 'string') {
      throw new TypeError('get_node: nodeId must be a string');
    }
    const node = await figmaCtx.getNodeByIdAsync(nodeId);
    const result: GetNodeResult = {
      node: node !== null && isSceneNode(node) ? await serializeWithin(node) : null,
    };
    return result;
  };
