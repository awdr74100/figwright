import type {
  GetLocalComponentsResult,
  SerializedComponentInfo,
  SerializedComponentSetInfo,
} from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

export const createGetLocalComponentsHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async () => {
    // Phase timing: this tool has been observed to "time out" on large multi-page files. We don't
    // yet know which phase dominates (page hydration vs the synchronous doc-wide scan vs serialize),
    // so log a one-line breakdown per call. Cheap (one console line, only when the tool is invoked)
    // and the prime signal for the routing/timeout stability work — keep until the bug is pinned.
    const t0 = Date.now();
    // Defensive `?.` so the debug instrumentation can never break the tool itself.
    const pageCount = figmaCtx.root.children?.length ?? 0;

    // findAllWithCriteria over the whole document requires every page loaded under dynamic-page access.
    await figmaCtx.loadAllPagesAsync();
    const tLoaded = Date.now();
    const nodes = figmaCtx.root.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] });
    const tScanned = Date.now();

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

    const tDone = Date.now();
    console.log(
      `[get_local_components] pages=${pageCount} nodes=${nodes.length} ` +
        `components=${components.length} sets=${componentSets.length} | ` +
        `loadAllPages=${tLoaded - t0}ms findAll=${tScanned - tLoaded}ms ` +
        `serialize=${tDone - tScanned}ms total=${tDone - t0}ms`,
    );

    const result: GetLocalComponentsResult = { components, componentSets };
    return result;
  };
