import type { ComponentPropertyResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { propertyDisplayName, resolveComponentOwner } from './component-property.js';

/**
 * Rename a component property, change its default value, or (INSTANCE_SWAP only) its preferred
 * values. editComponentProperty returns a fresh id when the name changes, so the new id is echoed
 * back for subsequent bind/delete calls. At least one change must be supplied.
 */
export const createEditComponentPropertyHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      componentId?: unknown;
      propertyId?: unknown;
      name?: unknown;
      defaultValue?: unknown;
      preferredValues?: unknown;
    };
    if (typeof p.componentId !== 'string') {
      throw new TypeError('edit_component_property: componentId must be a string');
    }
    if (typeof p.propertyId !== 'string') {
      throw new TypeError('edit_component_property: propertyId must be a string');
    }
    const renaming = typeof p.name === 'string';
    const redefaulting = p.defaultValue !== undefined;
    const repreferring = p.preferredValues !== undefined;
    if (!renaming && !redefaulting && !repreferring) {
      throw new TypeError(
        'edit_component_property: supply at least one of name / defaultValue / preferredValues',
      );
    }

    const node = await figmaCtx.getNodeByIdAsync(p.componentId);
    if (node === null) throw new Error(`edit_component_property: node ${p.componentId} not found`);
    const owner = resolveComponentOwner('edit_component_property', node);
    const def = owner.componentPropertyDefinitions[p.propertyId];
    if (def === undefined) {
      throw new Error(
        `edit_component_property: property ${p.propertyId} not found on ${owner.id} ` +
          '(get_component_api lists the current ids)',
      );
    }
    if (repreferring && def.type !== 'INSTANCE_SWAP') {
      throw new TypeError(
        'edit_component_property: preferredValues can only be edited on an INSTANCE_SWAP property',
      );
    }

    const newValue: {
      name?: string;
      defaultValue?: string | boolean;
      preferredValues?: InstanceSwapPreferredValue[];
    } = {};
    if (renaming) newValue.name = p.name as string;
    if (redefaulting) newValue.defaultValue = p.defaultValue as string | boolean;
    if (repreferring) newValue.preferredValues = p.preferredValues as InstanceSwapPreferredValue[];

    const propertyId = owner.editComponentProperty(p.propertyId, newValue);

    const result: ComponentPropertyResult = {
      ok: true,
      componentId: owner.id,
      propertyId,
      name: propertyDisplayName(propertyId),
    };
    return result;
  };
