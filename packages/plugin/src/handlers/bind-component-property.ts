import type { MutateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import {
  type AuthorablePropertyType,
  FIELD_FOR_TYPE,
  owningComponents,
  PROPERTY_TYPES,
} from './component-property.js';

const REF_FIELDS = ['visible', 'characters', 'mainComponent'] as const;
type RefField = (typeof REF_FIELDS)[number];

type Referencing = SceneNode & {
  componentPropertyReferences: Partial<Record<RefField, string>> | null;
};

/**
 * Bind a declared component property to a sublayer field so it actually drives the layer — a
 * BOOLEAN to `visible`, a TEXT to `characters`, an INSTANCE_SWAP to `mainComponent`. Repeatable:
 * the same property can drive several layers. Pass propertyId: null to remove the binding on that
 * field. Validates that the field fits the node, that the property exists on the containing
 * component, and that its type matches the field — a mis-bind otherwise fails silently or points a
 * layer at nothing.
 */
export const createBindComponentPropertyHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown; propertyId?: unknown; field?: unknown };
    if (typeof p.nodeId !== 'string') {
      throw new TypeError('bind_component_property: nodeId must be a string');
    }
    if (p.propertyId !== null && typeof p.propertyId !== 'string') {
      throw new TypeError('bind_component_property: propertyId must be a string or null');
    }
    if (typeof p.field !== 'string' || !REF_FIELDS.includes(p.field as RefField)) {
      throw new TypeError(
        `bind_component_property: field must be one of ${REF_FIELDS.join(' / ')}`,
      );
    }
    const field = p.field as RefField;

    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null) throw new Error(`bind_component_property: node ${p.nodeId} not found`);
    // A field must fit the node it drives: characters only on TEXT, mainComponent only on an
    // INSTANCE; visible works on any layer.
    if (field === 'characters' && node.type !== 'TEXT') {
      throw new Error(
        `bind_component_property: field "characters" requires a TEXT node, got ${node.type}`,
      );
    }
    if (field === 'mainComponent' && node.type !== 'INSTANCE') {
      throw new Error(
        `bind_component_property: field "mainComponent" requires an INSTANCE node, got ${node.type}`,
      );
    }

    const target = node as Referencing;
    const refs: Partial<Record<RefField, string>> = { ...target.componentPropertyReferences };

    if (p.propertyId === null) {
      delete refs[field];
    } else {
      // The property must exist on the containing component (or its set) and its type must match the
      // field — otherwise the reference dangles or drives the wrong thing.
      const owners = owningComponents(node);
      if (owners.length === 0) {
        throw new Error(
          `bind_component_property: ${p.nodeId} is not inside a component — nothing to bind a property to`,
        );
      }
      const def = owners
        .map(o => o.componentPropertyDefinitions[p.propertyId as string])
        .find(d => d !== undefined);
      if (def === undefined) {
        throw new Error(
          `bind_component_property: property ${p.propertyId} not found on the containing component ` +
            '(add it with add_component_property first)',
        );
      }
      if (!PROPERTY_TYPES.includes(def.type as AuthorablePropertyType)) {
        throw new Error(
          `bind_component_property: property ${p.propertyId} is a ${def.type} property, which isn't bound this way`,
        );
      }
      const expected = FIELD_FOR_TYPE[def.type as AuthorablePropertyType];
      if (expected !== field) {
        throw new Error(
          `bind_component_property: a ${def.type} property binds to "${expected}", not "${field}"`,
        );
      }
      refs[field] = p.propertyId;
    }

    target.componentPropertyReferences = refs;

    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
