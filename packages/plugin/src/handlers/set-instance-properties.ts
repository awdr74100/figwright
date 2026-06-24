import type { MutateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/**
 * Set an instance's component properties. Keys are the names from get_component_api (VARIANT by
 * bare name; BOOLEAN/TEXT/INSTANCE_SWAP suffixed `#id`), values are string / boolean /
 * VariableAlias. Unspecified properties keep their current value. Mirrors swap_component's instance
 * resolution; a bad value (unknown property, wrong variant option, SLOT) throws from setProperties
 * → tool error.
 */
export const createSetInstancePropertiesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { instanceId?: unknown; properties?: unknown };
    if (typeof p.instanceId !== 'string') {
      throw new TypeError('set_instance_properties: instanceId must be a string');
    }
    if (typeof p.properties !== 'object' || p.properties === null || Array.isArray(p.properties)) {
      throw new TypeError('set_instance_properties: properties must be an object map');
    }
    if (Object.keys(p.properties).length === 0) {
      throw new Error('set_instance_properties: provide at least one property to set');
    }

    const node = await figmaCtx.getNodeByIdAsync(p.instanceId);
    if (node === null || node.type !== 'INSTANCE') {
      throw new Error(`set_instance_properties: node ${p.instanceId} is not an INSTANCE`);
    }

    node.setProperties(
      p.properties as { [propertyName: string]: string | boolean | VariableAlias },
    );

    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
