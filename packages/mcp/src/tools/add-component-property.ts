import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const ADD_COMPONENT_PROPERTY_TOOL_NAME = 'add_component_property';

export const addComponentPropertyTool: ToolSpec = {
  name: ADD_COMPONENT_PROPERTY_TOOL_NAME,
  description:
    'Declare a component property on a component (or its variant set): BOOLEAN (show/hide a layer), ' +
    'TEXT (editable text), or INSTANCE_SWAP (swappable nested instance). The property starts inert — ' +
    'attach it to a layer with bind_component_property (BOOLEAN→visible, TEXT→characters, ' +
    'INSTANCE_SWAP→mainComponent) for it to do anything. defaultValue must match the type (boolean / ' +
    'string / a component key string); preferredValues (INSTANCE_SWAP only) pre-populates the swap ' +
    'menu. VARIANT properties come from combine_as_variants, not here. Returns { ok, componentId, ' +
    'propertyId, name } — pass propertyId to bind / edit / delete / set_instance_properties.',
  inputShape: {
    componentId: z
      .string()
      .describe('Component or component-set id (a variant resolves to its set)'),
    name: z.string().describe('Property name, e.g. "Show Icon"'),
    type: z.enum(['BOOLEAN', 'TEXT', 'INSTANCE_SWAP']).describe('Property type'),
    defaultValue: z
      .union([z.boolean(), z.string()])
      .describe('Default: boolean (BOOLEAN), string (TEXT), or a component key (INSTANCE_SWAP)'),
    preferredValues: z
      .array(z.object({ type: z.enum(['COMPONENT', 'COMPONENT_SET']), key: z.string() }))
      .describe('INSTANCE_SWAP only: components/sets offered in the swap menu')
      .optional(),
  },
  kind: 'write',
};
