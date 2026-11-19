import type { SerializedEffect, StyleResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { parseDocumentationLinks, writeDocumentationLinks } from '../documentation.js';
import { toFigmaEffectsBound } from './bindings.js';
import { fillNewStyle } from './style-snapshot.js';

export const createCreateEffectStyleHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      name?: unknown;
      effects?: unknown;
      description?: unknown;
      documentationLinks?: unknown;
    };
    if (typeof p.name !== 'string')
      throw new TypeError('create_effect_style: name must be a string');
    if (!Array.isArray(p.effects))
      throw new TypeError('create_effect_style: effects must be an array');
    // Checked before anything is resolved or created, so a malformed link is named as the argument
    // error it is.
    const links = parseDocumentationLinks(p.documentationLinks, 'create_effect_style');

    // Bindings resolve first, so a bad variable id fails before a half-built style exists.
    const effects = await toFigmaEffectsBound(
      figmaCtx,
      p.effects as SerializedEffect[],
      'create_effect_style',
    );

    const adjusted: string[] = [];

    const style = figmaCtx.createEffectStyle();
    // A value Figma refuses only surfaces on the write (a negative blur radius, measured): the style
    // it would have left behind is removed.
    await fillNewStyle(style, () => {
      style.name = p.name as string;
      style.effects = effects;
      if (typeof p.description === 'string') style.description = p.description;
      if (links !== undefined) {
        const note = writeDocumentationLinks(style, links);
        if (note !== undefined) adjusted.push(note);
      }
    });

    const result: StyleResult = { ok: true, styleId: style.id, name: style.name };
    if (adjusted.length > 0) result.adjusted = adjusted.join('; ');
    return result;
  };
