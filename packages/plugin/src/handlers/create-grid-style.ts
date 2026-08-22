import type { SerializedLayoutGrid, StyleResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { toFigmaLayoutGridsBound } from './bindings.js';

export const createCreateGridStyleHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  // eslint-disable-next-line @typescript-eslint/require-await
  async params => {
    const p = (params ?? {}) as { name?: unknown; grids?: unknown; description?: unknown };
    if (typeof p.name !== 'string') throw new TypeError('create_grid_style: name must be a string');
    if (!Array.isArray(p.grids)) throw new TypeError('create_grid_style: grids must be an array');

    // Bindings resolve first, so a bad variable id fails before a half-built style exists.
    const grids = await toFigmaLayoutGridsBound(
      figmaCtx,
      p.grids as SerializedLayoutGrid[],
      'create_grid_style',
    );

    const style = figmaCtx.createGridStyle();
    style.name = p.name;
    style.layoutGrids = grids;
    if (typeof p.description === 'string') style.description = p.description;

    const result: StyleResult = { ok: true, styleId: style.id, name: style.name };
    return result;
  };
