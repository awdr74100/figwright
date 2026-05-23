import type { CreateResult } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { placeNode } from './place.js';

export const createCreateFrameHandler =
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

    const frame = figmaCtx.createFrame();
    if (typeof p.name === 'string') frame.name = p.name;
    if (typeof p.width === 'number' && typeof p.height === 'number') {
      frame.resize(p.width, p.height);
    }
    if (typeof p.x === 'number') frame.x = p.x;
    if (typeof p.y === 'number') frame.y = p.y;

    await placeNode(figmaCtx, frame, p.parentId, 'create_frame');

    const result: CreateResult = { ok: true, nodeId: frame.id, name: frame.name, type: frame.type };
    return result;
  };
