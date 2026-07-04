import type { ComponentPropertyResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { propertyDisplayName, resolveComponentOwner } from './component-property.js';

/**
 * Remove a BOOLEAN / TEXT / INSTANCE_SWAP property from a component (and with it every sublayer
 * reference to it). VARIANT properties come from the variant-set structure, not
 * addComponentProperty, and deleteComponentProperty rejects them — so this refuses a VARIANT with
 * guidance rather than surfacing Figma's raw error.
 */
export const createDeleteComponentPropertyHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { componentId?: unknown; propertyId?: unknown };
    if (typeof p.componentId !== 'string') {
      throw new TypeError('delete_component_property: componentId must be a string');
    }
    if (typeof p.propertyId !== 'string') {
      throw new TypeError('delete_component_property: propertyId must be a string');
    }

    const node = await figmaCtx.getNodeByIdAsync(p.componentId);
    if (node === null)
      throw new Error(`delete_component_property: node ${p.componentId} not found`);
    const owner = resolveComponentOwner('delete_component_property', node);
    const def = owner.componentPropertyDefinitions[p.propertyId];
    if (def === undefined) {
      throw new Error(
        `delete_component_property: property ${p.propertyId} not found on ${owner.id}`,
      );
    }
    if (def.type === 'VARIANT') {
      throw new Error(
        `delete_component_property: ${p.propertyId} is a VARIANT property — remove its variants instead of deleting the property`,
      );
    }

    const name = propertyDisplayName(p.propertyId);
    owner.deleteComponentProperty(p.propertyId);

    const result: ComponentPropertyResult = {
      ok: true,
      componentId: owner.id,
      propertyId: p.propertyId,
      name,
    };
    return result;
  };
