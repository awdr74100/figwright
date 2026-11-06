import type {
  GetLocalComponentsResult,
  SerializedComponentInfo,
  SerializedComponentSetInfo,
} from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { readComponentGetter } from '../serializer.js';

export const createGetLocalComponentsHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: string };

    // Scope to a node subtree or the current selection — never the whole document. A doc-wide
    // findAllWithCriteria has to loadAllPagesAsync and walk every page, which times out on large
    // files (e.g. a big component-library page). Require an explicit target like the other reads.
    let roots: readonly BaseNode[];
    if (typeof p.nodeId === 'string') {
      // The document root is already available. Resolving it through the async API can wait on
      // Figma's connection in a background file before we can give the page-scoping guidance.
      const node =
        p.nodeId === figmaCtx.root.id ? figmaCtx.root : await figmaCtx.getNodeByIdAsync(p.nodeId);
      roots = node === null ? [] : [node];
    } else if (figmaCtx.currentPage.selection.length > 0) {
      roots = figmaCtx.currentPage.selection;
    } else {
      throw new Error(
        'Nothing selected. Select frames/layers in Figma (or pass an explicit nodeId). ' +
          'get_local_components scans a subtree, not the whole document (times out on large files).',
      );
    }

    if (roots.some(root => root.type === 'DOCUMENT')) {
      throw new Error(
        'get_local_components scans a subtree, not the whole document. ' +
          'Use get_pages to find a page, then pass its id as nodeId (or select frames to scan).',
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
        // Figma refuses both reads below while the variant's set has errors; that set is reported
        // with its error rather than failing every component found alongside it.
        const variant = readComponentGetter(() => node.variantProperties);
        if ('error' in variant) info.componentSetError = variant.error;
        else if (variant.value !== null) info.variantProperties = { ...variant.value };
        components.push(info);
      } else {
        const set: SerializedComponentSetInfo = {
          id: node.id,
          name: node.name,
          key: node.key,
          description: node.description,
          componentIds: node.children.map(child => child.id),
        };
        const groups = readComponentGetter(() => node.variantGroupProperties);
        if ('error' in groups) {
          set.componentSetError = groups.error;
        } else {
          set.variantGroupProperties = Object.fromEntries(
            Object.entries(groups.value).map(([prop, def]) => [prop, { values: [...def.values] }]),
          );
        }
        componentSets.push(set);
      }
    }

    const result: GetLocalComponentsResult = { components, componentSets };
    return result;
  };
