import type { SerializedEffect, StyleResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { parseDocumentationLinks, writeDocumentationLinks } from '../documentation.js';
import { toFigmaEffectsBound } from './bindings.js';
import {
  restoreStyle,
  snapshotStyle,
  styleResidue,
  writeStyleAtomically,
} from './style-snapshot.js';

export const createUpdateEffectStyleHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      styleId?: unknown;
      name?: unknown;
      effects?: unknown;
      description?: unknown;
      documentationLinks?: unknown;
    };
    if (typeof p.styleId !== 'string') {
      throw new TypeError('update_effect_style: styleId must be a string');
    }

    // Checked before anything is looked up, so a malformed link is named as the argument error it is.
    const links = parseDocumentationLinks(p.documentationLinks, 'update_effect_style');

    const style = await figmaCtx.getStyleByIdAsync(p.styleId);
    if (style === null || style.type !== 'EFFECT') {
      throw new Error(`update_effect_style: effect style ${p.styleId} not found`);
    }
    const es = style as EffectStyle;
    // Resolved before the first write: a missing variable used to fail here after the style had
    // already been renamed.
    const effects = Array.isArray(p.effects)
      ? await toFigmaEffectsBound(figmaCtx, p.effects as SerializedEffect[], 'update_effect_style')
      : undefined;
    // Only the fields this call writes: each read is a trip to Figma.
    const before = snapshotStyle(es, [
      ...(links !== undefined ? ['documentationLinks'] : []),
      ...(typeof p.name === 'string' ? ['name'] : []),
      ...(effects !== undefined ? ['effects'] : []),
      ...(typeof p.description === 'string' ? ['description'] : []),
    ]);
    const adjusted: string[] = [];
    await writeStyleAtomically(
      () => {
        // Written first, so a link Figma refuses ("Documentation link must be a URL") fails the call
        // before anything else is written.
        if (links !== undefined) {
          const note = writeDocumentationLinks(es, links);
          if (note !== undefined) adjusted.push(note);
        }
        if (typeof p.name === 'string') es.name = p.name;
        if (effects !== undefined) es.effects = effects;
        if (typeof p.description === 'string') es.description = p.description;
      },
      () => restoreStyle(es, before),
      () => styleResidue(es, before),
    );

    const result: StyleResult = { ok: true, styleId: es.id, name: es.name };
    if (adjusted.length > 0) result.adjusted = adjusted.join('; ');
    return result;
  };
