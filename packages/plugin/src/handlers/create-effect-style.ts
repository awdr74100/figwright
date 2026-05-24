import type { SerializedEffect, StyleResult } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { toFigmaEffect } from './convert.js';

export const createCreateEffectStyleHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  // eslint-disable-next-line @typescript-eslint/require-await
  async params => {
    const p = (params ?? {}) as { name?: unknown; effects?: unknown; description?: unknown };
    if (typeof p.name !== 'string') throw new TypeError('create_effect_style: name must be a string');
    if (!Array.isArray(p.effects)) throw new TypeError('create_effect_style: effects must be an array');

    const style = figmaCtx.createEffectStyle();
    style.name = p.name;
    style.effects = (p.effects as SerializedEffect[]).map(toFigmaEffect);
    if (typeof p.description === 'string') style.description = p.description;

    const result: StyleResult = { ok: true, styleId: style.id, name: style.name };
    return result;
  };
