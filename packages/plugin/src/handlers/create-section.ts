import type { CreateResult } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { placeNode } from './place.js';

export const createCreateSectionHandler =
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

    const section = figmaCtx.createSection();
    if (typeof p.name === 'string') section.name = p.name;
    // Sections size via resizeWithoutConstraints (they have no constraint behaviour).
    if (typeof p.width === 'number' && typeof p.height === 'number') {
      section.resizeWithoutConstraints(p.width, p.height);
    }
    if (typeof p.x === 'number') section.x = p.x;
    if (typeof p.y === 'number') section.y = p.y;

    await placeNode(figmaCtx, section, p.parentId, 'create_section');

    const result: CreateResult = {
      ok: true,
      nodeId: section.id,
      name: section.name,
      type: section.type,
    };
    return result;
  };
