import type { StyleResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

export const createImportStyleHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { styleKey?: unknown };
    if (typeof p.styleKey !== 'string' || p.styleKey.length === 0) {
      throw new TypeError('import_style: styleKey must be a non-empty string');
    }

    const style = await figmaCtx.importStyleByKeyAsync(p.styleKey);
    const result: StyleResult = { ok: true, styleId: style.id, name: style.name };
    return result;
  };
