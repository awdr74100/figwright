import type { GetAnnotationsResult, NodeAnnotations } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { serializeAnnotation } from '../serializer.js';
import { walk } from '../traverse.js';

const hasAnnotations = (
  node: BaseNode,
): node is BaseNode & { annotations: readonly Annotation[] } =>
  'annotations' in node && Array.isArray((node as { annotations?: unknown }).annotations);

export const createGetAnnotationsHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const nodeId = (params as { nodeId?: unknown } | null)?.nodeId;
    if (nodeId !== undefined && typeof nodeId !== 'string') {
      throw new TypeError('get_annotations: nodeId must be a string');
    }

    const out: NodeAnnotations[] = [];
    const collect = (node: BaseNode): void => {
      if (hasAnnotations(node) && node.annotations.length > 0) {
        out.push({
          nodeId: node.id,
          nodeName: node.name,
          annotations: node.annotations.map(serializeAnnotation),
        });
      }
    };

    if (typeof nodeId === 'string') {
      const node = await figmaCtx.getNodeByIdAsync(nodeId);
      if (node !== null) collect(node);
    } else {
      for (const node of walk(figmaCtx.currentPage.children)) collect(node);
    }

    const result: GetAnnotationsResult = { annotations: out };
    return result;
  };
