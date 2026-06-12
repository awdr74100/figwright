import type { CreateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { placeNode } from './place.js';

export const createCreateTextHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      parentId?: unknown;
      characters?: unknown;
      x?: unknown;
      y?: unknown;
      fontSize?: unknown;
    };
    if (typeof p.characters !== 'string') {
      throw new TypeError('create_text: characters must be a string');
    }

    const text = figmaCtx.createText();
    await figmaCtx.loadFontAsync(text.fontName as FontName); // default font must be loaded first
    text.characters = p.characters;
    if (typeof p.fontSize === 'number') text.fontSize = p.fontSize;
    if (typeof p.x === 'number') text.x = p.x;
    if (typeof p.y === 'number') text.y = p.y;

    await placeNode(figmaCtx, text, p.parentId, 'create_text');

    const result: CreateResult = { ok: true, nodeId: text.id, name: text.name, type: text.type };
    return result;
  };
