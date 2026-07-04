import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const BIND_COMPONENT_PROPERTY_TOOL_NAME = 'bind_component_property';

export const bindComponentPropertyTool: ToolSpec = {
  name: BIND_COMPONENT_PROPERTY_TOOL_NAME,
  description:
    'Attach a declared component property (from add_component_property) to a sublayer field so it ' +
    'drives that layer: field "visible" for a BOOLEAN, "characters" for a TEXT (the node must be a ' +
    'TEXT node), "mainComponent" for an INSTANCE_SWAP (the node must be an INSTANCE). The same ' +
    'property can be bound to several layers (call once per layer). Pass propertyId: null to remove ' +
    "the binding on that field. The property's type must match the field and it must exist on the " +
    'containing component. Returns { ok, nodeId }.',
  inputShape: {
    nodeId: z.string().describe('Sublayer inside the component to bind on'),
    field: z
      .enum(['visible', 'characters', 'mainComponent'])
      .describe('Which layer field the property drives'),
    propertyId: z
      .string()
      .nullable()
      .describe('Property id (name#id) to bind, or null to unbind this field'),
  },
  kind: 'write',
};
