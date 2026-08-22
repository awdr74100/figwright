import type {
  SerializedFontName,
  SerializedLetterSpacing,
  SerializedLineHeight,
  StyleResult,
} from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { toFigmaLineHeight } from './convert.js';

export const createCreateTextStyleHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      name?: unknown;
      fontName?: unknown;
      fontSize?: unknown;
      lineHeight?: unknown;
      letterSpacing?: unknown;
      textWrapStyle?: unknown;
      description?: unknown;
    };
    if (typeof p.name !== 'string') throw new TypeError('create_text_style: name must be a string');

    // Load the requested font BEFORE creating anything. It is the only step here that can fail on
    // caller input — a family/style the user does not have installed — and creating first would
    // leave an orphan style behind in the document's style panel (and in whatever it publishes to)
    // with no way to reach it from the failed call. Every sibling create_* handler validates before
    // it mutates; this is the same rule, applied to the one check that happens to be async.
    let fontName: FontName | undefined;
    if (p.fontName !== undefined) {
      const fn = p.fontName as SerializedFontName;
      fontName = { family: fn.family, style: fn.style };
      await figmaCtx.loadFontAsync(fontName);
    }

    const style = figmaCtx.createTextStyle();
    style.name = p.name;
    if (fontName !== undefined) style.fontName = fontName;
    // Every typography write below needs the style's own face loaded — Figma rejects them with
    // `Cannot write to node with unloaded font` otherwise, and a style the plugin did not put a
    // font on has none loaded. This load cannot fail on caller input: the face is either the one
    // hoisted above or Figma's own default for a fresh style, so it stays out of the pre-creation
    // validation above.
    await figmaCtx.loadFontAsync(style.fontName);
    if (typeof p.fontSize === 'number') style.fontSize = p.fontSize;
    if (p.lineHeight !== undefined)
      style.lineHeight = toFigmaLineHeight(p.lineHeight as SerializedLineHeight);
    if (p.letterSpacing !== undefined) {
      const ls = p.letterSpacing as SerializedLetterSpacing;
      style.letterSpacing = { unit: ls.unit as 'PIXELS' | 'PERCENT', value: ls.value };
    }
    if (typeof p.textWrapStyle === 'string') {
      style.textWrapStyle = p.textWrapStyle as TextStyle['textWrapStyle'];
    }
    if (typeof p.description === 'string') style.description = p.description;

    const result: StyleResult = { ok: true, styleId: style.id, name: style.name };
    return result;
  };
