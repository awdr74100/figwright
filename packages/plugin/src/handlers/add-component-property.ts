import type { ComponentPropertyResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import {
  type AuthorablePropertyType,
  PROPERTY_TYPES,
  resolveComponentOwner,
} from './component-property.js';

/**
 * Declare a BOOLEAN / TEXT / INSTANCE_SWAP property on a component (or its set). The property is
 * inert until bound to a sublayer field with bind_component_property; this handler only creates the
 * declaration and returns its Figma-assigned id ("name#id"), the handle every later
 * bind/edit/delete needs.
 */
export const createAddComponentPropertyHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      componentId?: unknown;
      name?: unknown;
      type?: unknown;
      defaultValue?: unknown;
      preferredValues?: unknown;
    };
    if (typeof p.componentId !== 'string') {
      throw new TypeError('add_component_property: componentId must be a string');
    }
    if (typeof p.name !== 'string' || p.name.length === 0) {
      throw new TypeError('add_component_property: name must be a non-empty string');
    }
    if (!PROPERTY_TYPES.includes(p.type as AuthorablePropertyType)) {
      throw new TypeError(
        `add_component_property: type must be one of ${PROPERTY_TYPES.join(' / ')} ` +
          '(VARIANT properties come from combine_as_variants)',
      );
    }
    const type = p.type as AuthorablePropertyType;

    // defaultValue must match the type: BOOLEAN → boolean, TEXT → string, INSTANCE_SWAP → a
    // component key string. A mismatch is the easy caller error, so reject it with a precise message.
    if (type === 'BOOLEAN' && typeof p.defaultValue !== 'boolean') {
      throw new TypeError(
        'add_component_property: a BOOLEAN property needs a boolean defaultValue',
      );
    }
    if ((type === 'TEXT' || type === 'INSTANCE_SWAP') && typeof p.defaultValue !== 'string') {
      throw new TypeError(
        `add_component_property: a ${type} property needs a string defaultValue` +
          (type === 'INSTANCE_SWAP' ? ' (a component key)' : ''),
      );
    }
    if (p.preferredValues !== undefined && type !== 'INSTANCE_SWAP') {
      throw new TypeError(
        'add_component_property: preferredValues is only valid for an INSTANCE_SWAP property',
      );
    }

    const node = await figmaCtx.getNodeByIdAsync(p.componentId);
    if (node === null) throw new Error(`add_component_property: node ${p.componentId} not found`);
    const owner = resolveComponentOwner('add_component_property', node);

    const options =
      type === 'INSTANCE_SWAP' && Array.isArray(p.preferredValues)
        ? { preferredValues: p.preferredValues as InstanceSwapPreferredValue[] }
        : undefined;
    const propertyId = owner.addComponentProperty(
      p.name,
      type,
      p.defaultValue as string | boolean,
      options,
    );

    const result: ComponentPropertyResult = {
      ok: true,
      componentId: owner.id,
      propertyId,
      name: p.name,
    };
    return result;
  };
