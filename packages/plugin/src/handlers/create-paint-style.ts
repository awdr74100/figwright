import type { SerializedPaint, StyleResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { parseDocumentationLinks, writeDocumentationLinks } from '../documentation.js';
import { toFigmaPaintsBound } from './bindings.js';
import { fillNewStyle } from './style-snapshot.js';

export const createCreatePaintStyleHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      name?: unknown;
      paints?: unknown;
      description?: unknown;
      documentationLinks?: unknown;
    };
    if (typeof p.name !== 'string')
      throw new TypeError('create_paint_style: name must be a string');
    if (!Array.isArray(p.paints))
      throw new TypeError('create_paint_style: paints must be an array');
    // Checked before anything is resolved or created, so a malformed link is named as the argument
    // error it is.
    const links = parseDocumentationLinks(p.documentationLinks, 'create_paint_style');

    // Resolve every binding before creating the style: a bad variable id must not leave a
    // half-built style behind in the design-system panel (the create_text_style lesson).
    const paints = await toFigmaPaintsBound(
      figmaCtx,
      p.paints as SerializedPaint[],
      'create_paint_style',
    );

    const adjusted: string[] = [];

    const style = figmaCtx.createPaintStyle();
    // A value Figma refuses only surfaces on the write (an opacity of 2, measured): the style it
    // would have left behind is removed.
    await fillNewStyle(style, () => {
      style.name = p.name as string;
      style.paints = paints;
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
