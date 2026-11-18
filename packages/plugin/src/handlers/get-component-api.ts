import type { ComponentPropertyApiEntry, GetComponentApiResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { readDocumentationExtras } from '../documentation.js';

/**
 * Resolve a node to the one that owns the full property contract: a COMPONENT_SET as-is, a
 * COMPONENT (climbing to its set when it's a variant, so VARIANT options are complete), or an
 * INSTANCE's main component / set. Returns null for anything else.
 */
const resolvePropertyOwner = async (
  node: BaseNode,
): Promise<ComponentNode | ComponentSetNode | null> => {
  if (node.type === 'COMPONENT_SET') return node;
  if (node.type === 'COMPONENT') {
    return node.parent !== null && node.parent.type === 'COMPONENT_SET' ? node.parent : node;
  }
  if (node.type === 'INSTANCE') {
    const main = await node.getMainComponentAsync();
    if (main === null) return null;
    return main.parent !== null && main.parent.type === 'COMPONENT_SET' ? main.parent : main;
  }
  return null;
};

/**
 * The resolved node's own documentation: its plain description when it has one, plus the fields
 * readDocumentationExtras adds. Each field is checked rather than assumed, so a runtime without one
 * reads as it did before.
 */
const readComponentDocumentation = (
  target: ComponentNode | ComponentSetNode,
): {
  description?: string;
  descriptionMarkdown?: string;
  documentationLinks?: { uri: string }[];
} => ({
  ...(typeof target.description === 'string' && target.description !== ''
    ? { description: target.description }
    : {}),
  ...readDocumentationExtras(target),
});

/**
 * Return a component's full property API (Figma's `componentPropertyDefinitions`), keyed verbatim
 * so the keys can be passed straight to set_instance_properties. Targets a single node — no
 * doc-wide scan, so unlike get_local_components it carries no large-file timeout risk.
 */
export const createGetComponentApiHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown; documentation?: unknown };
    // Opt-in, as on get_local_components: reading descriptionMarkdown costs Figma a conversion on
    // every call (measured 0.1–0.4 ms here, ~0.5–0.9 ms end to end), so a call that did not ask for
    // the documentation makes exactly the reads it made before the fields existed.
    const documentation = p.documentation === true;
    if (typeof p.nodeId !== 'string') {
      throw new TypeError('get_component_api: nodeId must be a string');
    }

    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null) throw new Error(`get_component_api: node ${p.nodeId} not found`);

    const target = await resolvePropertyOwner(node);
    if (target === null) {
      throw new Error(
        `get_component_api: node ${p.nodeId} (${node.type}) is not a component, component set, or instance`,
      );
    }

    const properties: Record<string, ComponentPropertyApiEntry> = {};
    for (const [name, def] of Object.entries(target.componentPropertyDefinitions)) {
      const entry: ComponentPropertyApiEntry = { type: def.type, defaultValue: def.defaultValue };
      if (def.variantOptions !== undefined) entry.variantOptions = [...def.variantOptions];
      if (def.preferredValues !== undefined) {
        entry.preferredValues = def.preferredValues.map(v => ({ type: v.type, key: v.key }));
      }
      if (typeof def.description === 'string' && def.description !== '') {
        entry.description = def.description;
      }
      properties[name] = entry;
    }

    const result: GetComponentApiResult = {
      id: target.id,
      name: target.name,
      type: target.type,
      ...(documentation ? readComponentDocumentation(target) : {}),
      properties,
    };
    return result;
  };
