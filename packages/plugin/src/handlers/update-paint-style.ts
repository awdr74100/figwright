import type { SerializedPaint, StyleResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { toFigmaPaintsBound } from './bindings.js';
import {
  restoreStyle,
  snapshotStyle,
  styleResidue,
  writeStyleAtomically,
} from './style-snapshot.js';

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
    // Resolved before the first write: a missing variable used to fail here after the style had
    // already been renamed.
    const paints = Array.isArray(p.paints)
      ? await toFigmaPaintsBound(figmaCtx, p.paints as SerializedPaint[], 'update_paint_style')
      : undefined;
    // Only the fields this call writes: each read is a trip to Figma.
    const before = snapshotStyle(ps, [
      ...(typeof p.name === 'string' ? ['name'] : []),
      ...(paints !== undefined ? ['paints'] : []),
      ...(typeof p.description === 'string' ? ['description'] : []),
    ]);
    await writeStyleAtomically(
      () => {
        if (typeof p.name === 'string') ps.name = p.name;
        if (paints !== undefined) ps.paints = paints;
        if (typeof p.description === 'string') ps.description = p.description;
      },
      () => restoreStyle(ps, before),
      () => styleResidue(ps, before),
    );

    const result: StyleResult = { ok: true, styleId: ps.id, name: ps.name };
    return result;
  };
