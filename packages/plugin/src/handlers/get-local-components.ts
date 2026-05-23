import type {
  GetLocalComponentsResult,
  SerializedComponentInfo,
  SerializedComponentSetInfo,
} from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

export const createGetLocalComponentsHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async () => {
    // findAllWithCriteria over the whole document requires every page loaded under dynamic-page access.
    await figmaCtx.loadAllPagesAsync();
    const nodes = figmaCtx.root.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] });

    const components: SerializedComponentInfo[] = [];
    const componentSets: SerializedComponentSetInfo[] = [];

    for (const node of nodes) {
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
