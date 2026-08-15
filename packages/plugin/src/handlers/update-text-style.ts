import type {
  SerializedFontName,
  SerializedLetterSpacing,
  SerializedLineHeight,
  StyleResult,
} from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
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
    // A new fontName must be loaded before assignment (Figma throws otherwise). Numeric fields
    // (fontSize / lineHeight / letterSpacing) don't need a load — they don't touch the glyph set.
    if (p.fontName !== undefined) {
      const fn = p.fontName as SerializedFontName;
      await figmaCtx.loadFontAsync({ family: fn.family, style: fn.style });
      ts.fontName = { family: fn.family, style: fn.style };
    }
    if (typeof p.fontSize === 'number') ts.fontSize = p.fontSize;
    if (p.lineHeight !== undefined)
      ts.lineHeight = toFigmaLineHeight(p.lineHeight as SerializedLineHeight);
    if (p.letterSpacing !== undefined) {
      const ls = p.letterSpacing as SerializedLetterSpacing;
      ts.letterSpacing = { unit: ls.unit as 'PIXELS' | 'PERCENT', value: ls.value };
    }
    // Unlike fontSize / lineHeight / letterSpacing, this one *does* need the font loaded — it
    // writes through to the style's text runs, so Figma rejects it against an unloaded font even
    // when the font itself is not changing. Load the style's current font (already the new one if
    // fontName was assigned above; loadFontAsync is cached, so the repeat is free).
    if (typeof p.textWrapStyle === 'string') {
      await figmaCtx.loadFontAsync(ts.fontName);
      ts.textWrapStyle = p.textWrapStyle as TextStyle['textWrapStyle'];
    }
    if (typeof p.description === 'string') ts.description = p.description;

    const result: StyleResult = { ok: true, styleId: ts.id, name: ts.name };
    return result;
  };
