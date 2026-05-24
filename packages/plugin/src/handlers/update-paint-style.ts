import type { SerializedPaint, StyleResult } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { toFigmaPaint } from './set-fills.js';

export const createUpdatePaintStyleHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      styleId?: unknown;
      name?: unknown;
      paints?: unknown;
      description?: unknown;
    };
    if (typeof p.styleId !== 'string') {
      throw new TypeError('update_paint_style: styleId must be a string');
    }

    const style = await figmaCtx.getStyleByIdAsync(p.styleId);
    if (style === null || style.type !== 'PAINT') {
      throw new Error(`update_paint_style: paint style ${p.styleId} not found`);
    }
    const ps = style as PaintStyle;
    if (typeof p.name === 'string') ps.name = p.name;
    if (Array.isArray(p.paints)) ps.paints = (p.paints as SerializedPaint[]).map(toFigmaPaint);
    if (typeof p.description === 'string') ps.description = p.description;

    const result: StyleResult = { ok: true, styleId: ps.id, name: ps.name };
    return result;
  };
