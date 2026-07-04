import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const EDIT_COMPONENT_PROPERTY_TOOL_NAME = 'edit_component_property';

export const editComponentPropertyTool: ToolSpec = {
  name: EDIT_COMPONENT_PROPERTY_TOOL_NAME,
  description:
    'Change an existing component property: rename it, change its defaultValue, or (INSTANCE_SWAP ' +
    'only) change its preferredValues. Supply at least one. Renaming returns a new propertyId (the ' +
    '#id suffix is kept but the name part changes), so use the returned propertyId for later calls; ' +
    'existing bindings keep working. Get current property ids from get_component_api. Returns ' +
    '{ ok, componentId, propertyId, name }.',
  inputShape: {
    componentId: z.string().describe('Component or component-set id that owns the property'),
    propertyId: z.string().describe('Property id to edit (name#id, from get_component_api / add)'),
    name: z.string().describe('New property name').optional(),
    defaultValue: z
      .union([z.boolean(), z.string()])
      .describe('New default (boolean / string / component key, matching the property type)')
      .optional(),
    preferredValues: z
      .array(z.object({ type: z.enum(['COMPONENT', 'COMPONENT_SET']), key: z.string() }))
      .describe('INSTANCE_SWAP only: replacement swap-menu components/sets')
      .optional(),
  },
  kind: 'write',
};
