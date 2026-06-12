import type { CreateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { placeNode } from './place.js';

export const createCreateComponentHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      parentId?: unknown;
      name?: unknown;
      x?: unknown;
      y?: unknown;
      width?: unknown;
      height?: unknown;
    };

    const component = figmaCtx.createComponent();
    if (typeof p.name === 'string') component.name = p.name;
    if (typeof p.width === 'number' && typeof p.height === 'number') {
      component.resize(p.width, p.height);
    }
    if (typeof p.x === 'number') component.x = p.x;
    if (typeof p.y === 'number') component.y = p.y;

    await placeNode(figmaCtx, component, p.parentId, 'create_component');

    const result: CreateResult = {
      ok: true,
      nodeId: component.id,
      name: component.name,
      type: component.type,
    };
    return result;
  };
