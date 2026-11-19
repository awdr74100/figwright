import type { SerializedLayoutGrid, StyleResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { parseDocumentationLinks, writeDocumentationLinks } from '../documentation.js';
import { toFigmaLayoutGridsBound } from './bindings.js';
import { fillNewStyle } from './style-snapshot.js';

export const createCreateGridStyleHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      name?: unknown;
      grids?: unknown;
      description?: unknown;
      documentationLinks?: unknown;
    };
    if (typeof p.name !== 'string') throw new TypeError('create_grid_style: name must be a string');
    if (!Array.isArray(p.grids)) throw new TypeError('create_grid_style: grids must be an array');
    // Checked before anything is resolved or created, so a malformed link is named as the argument
    // error it is.
    const links = parseDocumentationLinks(p.documentationLinks, 'create_grid_style');

    // Bindings resolve first, so a bad variable id fails before a half-built style exists.
    const adjusted: string[] = [];
    const grids = await toFigmaLayoutGridsBound(
      figmaCtx,
      p.grids as SerializedLayoutGrid[],
      'create_grid_style',
      adjusted,
    );

    const style = figmaCtx.createGridStyle();
    // A grid Figma refuses only surfaces on the write (a stretch grid with a sectionSize,
    // measured): the style it would have left behind is removed.
    await fillNewStyle(style, () => {
      style.name = p.name as string;
      style.layoutGrids = grids;
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
