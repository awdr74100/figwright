import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const GET_COMPONENT_API_TOOL_NAME = 'get_component_api';

export const getComponentApiTool: ToolSpec = {
  name: GET_COMPONENT_API_TOOL_NAME,
  description:
    "Return a component's full property API — the prop contract behind its instances. Pass a " +
    'COMPONENT, COMPONENT_SET, or INSTANCE id (an instance resolves to its main component / set). ' +
    'Returns { id, name, type, properties } where properties maps each property name to ' +
    '{ type (VARIANT|BOOLEAN|TEXT|INSTANCE_SWAP|SLOT), defaultValue, variantOptions?, preferredValues?, ' +
    'description? }. Property names come back verbatim for set_instance_properties: VARIANT by bare name ' +
    '(e.g. "Size"), BOOLEAN/TEXT/INSTANCE_SWAP suffixed with #id (e.g. "Label#2:0"). Unlike ' +
    'get_local_components (a subtree inventory), this targets one component and is safe on large files.',
  inputShape: {
    nodeId: z
      .string()
      .describe('A COMPONENT, COMPONENT_SET, or INSTANCE node id to read the property API of'),
  },
  kind: 'read',
};
