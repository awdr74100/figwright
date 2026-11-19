import type { SerializedLayoutGrid, StyleResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { parseDocumentationLinks, writeDocumentationLinks } from '../documentation.js';
import { toFigmaLayoutGridsBound } from './bindings.js';
import {
  restoreStyle,
  snapshotStyle,
  styleResidue,
  writeStyleAtomically,
} from './style-snapshot.js';

const TOOL = 'update_grid_style';

/**
 * Update a grid style in place — its name, grids, description and documentation link — so frames
 * using it follow, and its id, and so every frame's link to it, stays. The one style kind that had
 * no update: changing a grid style meant deleting and recreating it, which mints a new id and
 * detaches every frame that used it.
 *
 * Built on the same rules as update_paint_style: everything that can fail before a write is done
 * first (the grids converted, their bindings resolved, the link checked), a write Figma refuses
 * mid-call puts back what the call had written, and a grid colour Figma would refuse is left out
 * and named in `adjusted` rather than failing the grids around it.
 */
export const createUpdateGridStyleHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      styleId?: unknown;
      name?: unknown;
      grids?: unknown;
      description?: unknown;
      documentationLinks?: unknown;
    };
    if (typeof p.styleId !== 'string') throw new TypeError(`${TOOL}: styleId must be a string`);
    if (p.name !== undefined && typeof p.name !== 'string') {
      throw new TypeError(`${TOOL}: name must be a string`);
    }
    if (p.grids !== undefined && !Array.isArray(p.grids)) {
      throw new TypeError(`${TOOL}: grids must be an array`);
    }
    if (p.description !== undefined && typeof p.description !== 'string') {
      throw new TypeError(`${TOOL}: description must be a string`);
    }
    const links = parseDocumentationLinks(p.documentationLinks, TOOL);

    const style = await figmaCtx.getStyleByIdAsync(p.styleId);
    if (style === null || style.type !== 'GRID') {
      throw new Error(`${TOOL}: grid style ${p.styleId} not found`);
    }
    const gs = style as GridStyle;

    const adjusted: string[] = [];
    // Converted and resolved before the first write: a missing variable fails with the style as it
    // was.
    const grids = Array.isArray(p.grids)
      ? await toFigmaLayoutGridsBound(figmaCtx, p.grids as SerializedLayoutGrid[], TOOL, adjusted)
      : undefined;

    // Only the fields this call writes: each read is a trip to Figma.
    const before = snapshotStyle(gs, [
      ...(links !== undefined ? ['documentationLinks'] : []),
      ...(typeof p.name === 'string' ? ['name'] : []),
      ...(grids !== undefined ? ['layoutGrids'] : []),
      ...(typeof p.description === 'string' ? ['description'] : []),
    ]);
    await writeStyleAtomically(
      () => {
        // Written first, so a link Figma refuses ("Documentation link must be a URL") fails the call
        // before anything else is written.
        if (links !== undefined) {
          const note = writeDocumentationLinks(gs, links);
          if (note !== undefined) adjusted.push(note);
        }
        if (typeof p.name === 'string') gs.name = p.name;
        if (grids !== undefined) gs.layoutGrids = grids;
        if (typeof p.description === 'string') gs.description = p.description;
      },
      () => restoreStyle(gs, before),
      () => styleResidue(gs, before),
    );

    const result: StyleResult = { ok: true, styleId: gs.id, name: gs.name };
    if (adjusted.length > 0) result.adjusted = adjusted.join('; ');
    return result;
  };
