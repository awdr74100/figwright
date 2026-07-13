import type { SerializedEffect, StyleResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { toFigmaEffect } from './convert.js';

export const createUpdateEffectStyleHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      styleId?: unknown;
      name?: unknown;
      effects?: unknown;
      description?: unknown;
    };
    if (typeof p.styleId !== 'string') {
      throw new TypeError('update_effect_style: styleId must be a string');
    }

    const style = await figmaCtx.getStyleByIdAsync(p.styleId);
    if (style === null || style.type !== 'EFFECT') {
      throw new Error(`update_effect_style: effect style ${p.styleId} not found`);
    }
    const es = style as EffectStyle;
    if (typeof p.name === 'string') es.name = p.name;
    if (Array.isArray(p.effects)) es.effects = (p.effects as SerializedEffect[]).map(toFigmaEffect);
    if (typeof p.description === 'string') es.description = p.description;

    const result: StyleResult = { ok: true, styleId: es.id, name: es.name };
    return result;
  };
