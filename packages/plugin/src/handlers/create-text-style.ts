import type { SerializedLetterSpacing, SerializedLineHeight, StyleResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { parseDocumentationLinks, writeDocumentationLinks } from '../documentation.js';
import {
  applyTextStyleBindings,
  resolveTextStyleBindings,
  type TextStyleBindings,
} from './bindings.js';
import { toFigmaFontName, toFigmaLineHeight } from './convert.js';
import { fillNewStyle } from './style-snapshot.js';

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
      boundVariables?: unknown;
      description?: unknown;
      documentationLinks?: unknown;
    };
    if (typeof p.name !== 'string') throw new TypeError('create_text_style: name must be a string');
    // Checked before anything is resolved or created, so a malformed link is named as the argument
    // error it is.
    const links = parseDocumentationLinks(p.documentationLinks, 'create_text_style');

    // Everything that can fail on caller input happens BEFORE anything is created. Creating first
    // would leave an orphan style behind in the document's style panel (and in whatever it
    // publishes to) with no way to reach it from the failed call. Every sibling create_* handler
    // validates before it mutates; these are the same rule applied to the two checks that happen
    // to be async — a variable id that matches nothing, and a font the user has not installed.
    const bindings = p.boundVariables as TextStyleBindings | undefined;
    const table =
      bindings === undefined
        ? undefined
        : await resolveTextStyleBindings(figmaCtx, bindings, 'create_text_style');

    let fontName: FontNameInput | undefined;
    if (p.fontName !== undefined) {
      fontName = toFigmaFontName(p.fontName as Record<string, unknown>);
      await figmaCtx.loadFontAsync(fontName);
    }

    const adjusted: string[] = [];

    const style = figmaCtx.createTextStyle();
    // What is left after both hoists: a binding's target FACE is only computable once the style's
    // base face is known, and that is only after creation when fontName was omitted. So that one
    // orphan is undone instead of prevented — the same outcome, by the only route left.
    await fillNewStyle(style, async () => {
      style.name = p.name as string;
      // `fontName` is declared as `FontName` even though its own JSDoc says the API accepts a
      // `FontNameInput` — the typings widened the setters but not the property. Cast rather than
      // force a `style` the caller may have deliberately left to Figma to resolve.
      if (fontName !== undefined) style.fontName = fontName as FontName;
      // Every typography write below needs the style's own face loaded — Figma rejects them with
      // `Cannot write to node with unloaded font` otherwise, and a style the plugin did not put a
      // font on has none loaded. This load cannot fail on caller input: the face is either the one
      // hoisted above or Figma's own default for a fresh style.
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
      if (bindings !== undefined && table !== undefined) {
        await applyTextStyleBindings(figmaCtx, style, bindings, table);
      }
      if (links !== undefined) {
        const note = writeDocumentationLinks(style, links);
        if (note !== undefined) adjusted.push(note);
      }
    });

    const result: StyleResult = { ok: true, styleId: style.id, name: style.name };
    if (adjusted.length > 0) result.adjusted = adjusted.join('; ');
    return result;
  };
