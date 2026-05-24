import type { SerializedLayoutGrid, StyleResult } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { toFigmaLayoutGrid } from './convert.js';

export const createCreateGridStyleHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  // eslint-disable-next-line @typescript-eslint/require-await
  async params => {
    const p = (params ?? {}) as { name?: unknown; grids?: unknown; description?: unknown };
    if (typeof p.name !== 'string') throw new TypeError('create_grid_style: name must be a string');
    if (!Array.isArray(p.grids)) throw new TypeError('create_grid_style: grids must be an array');

    const style = figmaCtx.createGridStyle();
    style.name = p.name;
    style.layoutGrids = (p.grids as SerializedLayoutGrid[]).map(toFigmaLayoutGrid);
    if (typeof p.description === 'string') style.description = p.description;

    const result: StyleResult = { ok: true, styleId: style.id, name: style.name };
    return result;
  };
