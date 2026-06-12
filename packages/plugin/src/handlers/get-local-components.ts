import type {
  GetLocalComponentsResult,
  SerializedComponentInfo,
  SerializedComponentSetInfo,
} from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

export const createGetLocalComponentsHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: string };

    // Scope to a node subtree or the current selection — never the whole document. A doc-wide
    // findAllWithCriteria has to loadAllPagesAsync and walk every page, which times out on large
    // files (e.g. a big component-library page). Require an explicit target like the other reads.
    let roots: readonly BaseNode[];
    if (typeof p.nodeId === 'string') {
      const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
      roots = node === null ? [] : [node];
    } else if (figmaCtx.currentPage.selection.length > 0) {
      roots = figmaCtx.currentPage.selection;
    } else {
      throw new Error(
        'Nothing selected. Select frames/layers in Figma (or pass an explicit nodeId). ' +
          'get_local_components scans a subtree, not the whole document (times out on large files).',
      );
    }

    const found = new Map<string, ComponentNode | ComponentSetNode>();
    for (const root of roots) {
      if (root.type === 'COMPONENT' || root.type === 'COMPONENT_SET') found.set(root.id, root);
      if ('findAllWithCriteria' in root) {
        const hits = (
          root as {
            findAllWithCriteria: (c: {
              types: ['COMPONENT', 'COMPONENT_SET'];
            }) => (ComponentNode | ComponentSetNode)[];
          }
        ).findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] });
        for (const n of hits) found.set(n.id, n);
      }
    }

    const components: SerializedComponentInfo[] = [];
    const componentSets: SerializedComponentSetInfo[] = [];

    for (const node of found.values()) {
      if (node.type === 'COMPONENT') {
        const info: SerializedComponentInfo = {
          id: node.id,
          name: node.name,
          key: node.key,
          description: node.description,
          parentId: node.parent === null ? null : node.parent.id,
        };
        if (node.variantProperties !== null) {
          info.variantProperties = { ...node.variantProperties };
        }
        components.push(info);
      } else {
        componentSets.push({
          id: node.id,
          name: node.name,
          key: node.key,
          description: node.description,
          componentIds: node.children.map(child => child.id),
          variantGroupProperties: Object.fromEntries(
            Object.entries(node.variantGroupProperties).map(([prop, def]) => [
              prop,
              { values: [...def.values] },
            ]),
          ),
        });
      }
    }

    const result: GetLocalComponentsResult = { components, componentSets };
    return result;
  };
