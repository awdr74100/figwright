import type {
  SerializedFontName,
  SerializedLetterSpacing,
  SerializedLineHeight,
  StyleResult,
} from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import {
  applyTextStyleBindings,
  resolveTextStyleBindings,
  type TextStyleBindings,
} from './bindings.js';
import { toFigmaLineHeight } from './convert.js';

export const createUpdateTextStyleHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      styleId?: unknown;
      name?: unknown;
      fontName?: unknown;
      fontSize?: unknown;
      lineHeight?: unknown;
      letterSpacing?: unknown;
      textWrapStyle?: unknown;
      boundVariables?: unknown;
      description?: unknown;
    };
    if (typeof p.styleId !== 'string') {
      throw new TypeError('update_text_style: styleId must be a string');
    }

    const style = await figmaCtx.getStyleByIdAsync(p.styleId);
    if (style === null || style.type !== 'TEXT') {
      throw new Error(`update_text_style: text style ${p.styleId} not found`);
    }
    const ts = style as TextStyle;
    if (typeof p.name === 'string') ts.name = p.name;
    // A new fontName must be loaded before assignment (Figma throws otherwise).
    if (p.fontName !== undefined) {
      const fn = p.fontName as SerializedFontName;
      await figmaCtx.loadFontAsync({ family: fn.family, style: fn.style });
      ts.fontName = { family: fn.family, style: fn.style };
    }
    // So must the style's CURRENT face, before any typography write — fontSize / lineHeight /
    // letterSpacing / textWrapStyle all write through to the style's text runs, and Figma rejects
    // each with `Cannot write to node with unloaded font` against a face this session never
    // loaded. That is most styles: nothing loads a font just by reading it, so before this an
    // update that touched only fontSize failed on any style the caller had not also re-fonted.
    // loadFontAsync is cached, so repeating it after the assignment above is free.
    await figmaCtx.loadFontAsync(ts.fontName);
    if (typeof p.fontSize === 'number') ts.fontSize = p.fontSize;
    if (p.lineHeight !== undefined)
      ts.lineHeight = toFigmaLineHeight(p.lineHeight as SerializedLineHeight);
    if (p.letterSpacing !== undefined) {
      const ls = p.letterSpacing as SerializedLetterSpacing;
      ts.letterSpacing = { unit: ls.unit as 'PIXELS' | 'PERCENT', value: ls.value };
    }
    if (typeof p.textWrapStyle === 'string') {
      ts.textWrapStyle = p.textWrapStyle as TextStyle['textWrapStyle'];
    }
    if (typeof p.description === 'string') ts.description = p.description;
    // Last, so a bound field wins over a literal set for the same field above.
    if (p.boundVariables !== undefined) {
      const bindings = p.boundVariables as TextStyleBindings;
      const table = await resolveTextStyleBindings(figmaCtx, bindings, 'update_text_style');
      await applyTextStyleBindings(figmaCtx, ts, bindings, table);
    }

    const result: StyleResult = { ok: true, styleId: ts.id, name: ts.name };
    return result;
  };
