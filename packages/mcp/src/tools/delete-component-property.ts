import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const DELETE_COMPONENT_PROPERTY_TOOL_NAME = 'delete_component_property';

export const deleteComponentPropertyTool: ToolSpec = {
  name: DELETE_COMPONENT_PROPERTY_TOOL_NAME,
  description:
    'Remove a BOOLEAN / TEXT / INSTANCE_SWAP property from a component and every sublayer reference ' +
    'to it. VARIANT properties are the variant-set structure — delete their variants instead; this ' +
    'refuses a VARIANT. Get current property ids from get_component_api. Returns { ok, componentId, ' +
    'propertyId, name }.',
  inputShape: {
    componentId: z.string().describe('Component or component-set id that owns the property'),
    propertyId: z.string().describe('Property id to delete (name#id, from get_component_api)'),
  },
  kind: 'write',
  destructive: true,
};
