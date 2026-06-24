import type { CreateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { placeNode } from './place.js';

export const createCreateComponentHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      fromNodeId?: unknown;
      parentId?: unknown;
      name?: unknown;
      x?: unknown;
      y?: unknown;
      width?: unknown;
      height?: unknown;
    };

    // fromNodeId → componentize an existing node (createComponentFromNode replaces it in place,
    // keeping its parent + position); otherwise create an empty component to build into.
    let component: ComponentNode;
    let alreadyPlaced = false;
    if (typeof p.fromNodeId === 'string') {
      const source = await figmaCtx.getNodeByIdAsync(p.fromNodeId);
      if (source === null) {
        throw new Error(`create_component: node ${p.fromNodeId} not found`);
      }
      if (
        source.type === 'PAGE' ||
        source.type === 'DOCUMENT' ||
        source.type === 'COMPONENT' ||
        source.type === 'COMPONENT_SET'
      ) {
        throw new Error(
          `create_component: node ${p.fromNodeId} (${source.type}) can't be turned into a component`,
        );
      }
      component = figmaCtx.createComponentFromNode(source as SceneNode);
      alreadyPlaced = true;
    } else {
      component = figmaCtx.createComponent();
    }

    if (typeof p.name === 'string') component.name = p.name;
    if (typeof p.width === 'number' && typeof p.height === 'number') {
      component.resize(p.width, p.height);
    }
    if (typeof p.x === 'number') component.x = p.x;
    if (typeof p.y === 'number') component.y = p.y;

    // An empty component must be placed; a componentized node is already in the tree — only reparent
    // it when an explicit parentId is given (else it stays where the source node was).
    if (!alreadyPlaced || typeof p.parentId === 'string') {
      await placeNode(figmaCtx, component, p.parentId, 'create_component');
    }

    const result: CreateResult = {
      ok: true,
      nodeId: component.id,
      name: component.name,
      type: component.type,
    };
    return result;
  };
