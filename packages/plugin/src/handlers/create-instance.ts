import type { CreateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { placeNode } from './place.js';

/**
 * Instantiate a component (local `componentId` or published `componentKey`) and place it like the
 * other create_* tools. Mirrors swap_component's component resolution; undo (in batch) = remove.
 */
export const createCreateInstanceHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      componentId?: unknown;
      componentKey?: unknown;
      parentId?: unknown;
      name?: unknown;
      x?: unknown;
      y?: unknown;
    };
    if (typeof p.componentId !== 'string' && typeof p.componentKey !== 'string') {
      throw new TypeError('create_instance: provide componentId or componentKey');
    }

    let component: ComponentNode;
    if (typeof p.componentKey === 'string') {
      component = await figmaCtx.importComponentByKeyAsync(p.componentKey);
    } else {
      const node = await figmaCtx.getNodeByIdAsync(p.componentId as string);
      if (node === null || node.type !== 'COMPONENT') {
        throw new Error(`create_instance: component ${String(p.componentId)} not found`);
      }
      component = node as ComponentNode;
    }

    const instance = component.createInstance();
    if (typeof p.name === 'string') instance.name = p.name;
    if (typeof p.x === 'number') instance.x = p.x;
    if (typeof p.y === 'number') instance.y = p.y;

    await placeNode(figmaCtx, instance, p.parentId, 'create_instance');

    const result: CreateResult = {
      ok: true,
      nodeId: instance.id,
      name: instance.name,
      type: instance.type,
    };
    return result;
  };
