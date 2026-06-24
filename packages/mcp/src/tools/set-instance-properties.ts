import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_INSTANCE_PROPERTIES_TOOL_NAME = 'set_instance_properties';

// A named union (mirrors set_variable_value): an untyped value gets string-coerced by some MCP clients
// in transit, which then fails Figma's per-property type check. Naming each member keeps the derived
// JSON Schema explicit. The alias object lets a property be driven by a variable.
const instancePropertyValue = z
  .union([
    z.string(),
    z.boolean(),
    z.looseObject({ type: z.literal('VARIABLE_ALIAS'), id: z.string() }),
  ])
  .describe(
    'string (VARIANT / TEXT / INSTANCE_SWAP target component id) | boolean (BOOLEAN) | { type:"VARIABLE_ALIAS", id }',
  );

export const setInstancePropertiesTool: ToolSpec = {
  name: SET_INSTANCE_PROPERTIES_TOOL_NAME,
  description:
    "Set an instance's component properties (variant / boolean / text / instance-swap). Keys are the " +
    'property names from get_component_api, used verbatim: VARIANT by bare name (e.g. "Size": "Large"), ' +
    'BOOLEAN/TEXT/INSTANCE_SWAP suffixed with #id (e.g. "Label#2:0": "Sign in", "Disabled#1:2": true). ' +
    'An INSTANCE_SWAP value is the target component node id. Unspecified properties keep their value; ' +
    'SLOT properties are not settable. Returns { ok, nodeId }.',
  inputShape: {
    instanceId: z.string().describe('Instance node id to update'),
    properties: z
      .record(z.string(), instancePropertyValue)
      .describe('Map of property name (verbatim from get_component_api) → value'),
  },
  kind: 'write',
};
