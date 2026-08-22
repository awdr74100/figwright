import type { SerializedPaint, StyleResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { toFigmaPaintsBound } from './bindings.js';

export const createCreatePaintStyleHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { name?: unknown; paints?: unknown; description?: unknown };
    if (typeof p.name !== 'string')
      throw new TypeError('create_paint_style: name must be a string');
    if (!Array.isArray(p.paints))
      throw new TypeError('create_paint_style: paints must be an array');

    // Resolve every binding before creating the style: a bad variable id must not leave a
    // half-built style behind in the design-system panel (the create_text_style lesson).
    const paints = await toFigmaPaintsBound(
      figmaCtx,
      p.paints as SerializedPaint[],
      'create_paint_style',
    );

    const style = figmaCtx.createPaintStyle();
    style.name = p.name;
    style.paints = paints;
    if (typeof p.description === 'string') style.description = p.description;

    const result: StyleResult = { ok: true, styleId: style.id, name: style.name };
    return result;
  };
