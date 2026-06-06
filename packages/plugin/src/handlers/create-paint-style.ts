import type { SerializedPaint, StyleResult } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { toFigmaPaint } from './set-fills.js';

export const createCreatePaintStyleHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  // eslint-disable-next-line @typescript-eslint/require-await
  async params => {
    const p = (params ?? {}) as { name?: unknown; paints?: unknown; description?: unknown };
    if (typeof p.name !== 'string')
      throw new TypeError('create_paint_style: name must be a string');
    if (!Array.isArray(p.paints))
      throw new TypeError('create_paint_style: paints must be an array');

    const style = figmaCtx.createPaintStyle();
    style.name = p.name;
    style.paints = (p.paints as SerializedPaint[]).map(toFigmaPaint);
    if (typeof p.description === 'string') style.description = p.description;

    const result: StyleResult = { ok: true, styleId: style.id, name: style.name };
    return result;
  };
