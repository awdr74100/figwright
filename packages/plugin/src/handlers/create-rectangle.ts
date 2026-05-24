import type { CreateResult } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { placeNode } from './place.js';

export const createCreateRectangleHandler =
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

    const rect = figmaCtx.createRectangle();
    if (typeof p.name === 'string') rect.name = p.name;
    if (typeof p.width === 'number' && typeof p.height === 'number') rect.resize(p.width, p.height);
    if (typeof p.x === 'number') rect.x = p.x;
    if (typeof p.y === 'number') rect.y = p.y;

    await placeNode(figmaCtx, rect, p.parentId, 'create_rectangle');

    const result: CreateResult = { ok: true, nodeId: rect.id, name: rect.name, type: rect.type };
    return result;
  };
