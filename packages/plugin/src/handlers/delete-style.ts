import type { StyleResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

export const createDeleteStyleHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { styleId?: unknown };
    if (typeof p.styleId !== 'string')
      throw new TypeError('delete_style: styleId must be a string');

    const style = await figmaCtx.getStyleByIdAsync(p.styleId);
    if (style === null) throw new Error(`delete_style: style ${p.styleId} not found`);
    const name = style.name; // capture before remove(), which invalidates the handle
    style.remove();

    const result: StyleResult = { ok: true, styleId: p.styleId, name };
    return result;
  };
