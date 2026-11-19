import type { SerializedLetterSpacing, SerializedLineHeight, StyleResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { parseDocumentationLinks, writeDocumentationLinks } from '../documentation.js';
import {
  applyTextStyleBindings,
  resolveTextStyleBindings,
  type TextStyleBindings,
} from './bindings.js';
import { toFigmaFontName, toFigmaLineHeight } from './convert.js';
import {
  restoreTextStyle,
  snapshotTextStyle,
  textStyleResidue,
  writeStyleAtomically,
} from './style-snapshot.js';

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
      documentationLinks?: unknown;
    };
    if (typeof p.styleId !== 'string') {
      throw new TypeError('update_text_style: styleId must be a string');
    }

    // Checked before anything is looked up, so a malformed link is named as the argument error it is.
    const links = parseDocumentationLinks(p.documentationLinks, 'update_text_style');

    const style = await figmaCtx.getStyleByIdAsync(p.styleId);
    if (style === null || style.type !== 'TEXT') {
      throw new Error(`update_text_style: text style ${p.styleId} not found`);
    }
    const ts = style as TextStyle;

    // Everything that can fail before a write is done first — a font that does not load, a
    // variable that does not exist — so it fails with the style untouched. Each used to fail after
    // the style had been renamed (and, for a binding, resized and re-described).
    const fontName =
      p.fontName === undefined ? undefined : toFigmaFontName(p.fontName as Record<string, unknown>);
    // A new fontName must be loaded before assignment (Figma throws otherwise).
    if (fontName !== undefined) await figmaCtx.loadFontAsync(fontName);
    // So must the style's CURRENT face, before any typography write — fontSize / lineHeight /
    // letterSpacing / textWrapStyle all write through to the style's text runs, and Figma rejects
    // each with `Cannot write to node with unloaded font` against a face this session never
    // loaded. That is most styles: nothing loads a font just by reading it, so before this an
    // update that touched only fontSize failed on any style the caller had not also re-fonted.
    // A name or description is not typography: measured 2026-11-19, both write with the face never
    // loaded (fontSize and lineHeight, in the same session, refused). So a call that changes only
    // those does not load it — and a style whose font cannot be loaded at all can still be renamed
    // and described, where the unconditional load used to fail the call. Bindings keep the load:
    // whether one needs it was not measured, so they stay exactly as they were.
    else if (
      typeof p.fontSize === 'number' ||
      p.lineHeight !== undefined ||
      p.letterSpacing !== undefined ||
      typeof p.textWrapStyle === 'string' ||
      p.boundVariables !== undefined
    ) {
      await figmaCtx.loadFontAsync(ts.fontName);
    }
    const lineHeight =
      p.lineHeight === undefined
        ? undefined
        : toFigmaLineHeight(p.lineHeight as SerializedLineHeight);
    const bindings = p.boundVariables as TextStyleBindings | undefined;
    const table =
      bindings === undefined
        ? undefined
        : await resolveTextStyleBindings(figmaCtx, bindings, 'update_text_style');

    // Only what this call can move, read once: its labels and the literals it writes, plus the
    // bindings — a literal written to a bound fontSize / lineHeight / letterSpacing /
    // paragraphSpacing takes the binding off (measured 2026-11-19), so a later failure has one to
    // put back. Everything when it applies bindings or changes the font, either of which may move
    // typography it did not name (measured to keep a fontFamily binding; the rest assumed).
    const literals = [
      ...(fontName !== undefined ? ['fontName'] : []),
      ...(typeof p.fontSize === 'number' ? ['fontSize'] : []),
      ...(lineHeight !== undefined ? ['lineHeight'] : []),
      ...(p.letterSpacing !== undefined ? ['letterSpacing'] : []),
      ...(typeof p.textWrapStyle === 'string' ? ['textWrapStyle'] : []),
    ];
    const labels = [
      ...(links !== undefined ? ['documentationLinks'] : []),
      ...(typeof p.name === 'string' ? ['name'] : []),
      ...(typeof p.description === 'string' ? ['description'] : []),
    ];
    const before =
      bindings !== undefined || fontName !== undefined
        ? snapshotTextStyle(ts)
        : snapshotTextStyle(ts, [...labels, ...literals], literals.length > 0);
    const adjusted: string[] = [];
    await writeStyleAtomically(
      async () => {
        // Written first, so a link Figma refuses ("Documentation link must be a URL") fails the call
        // before anything else is written.
        if (links !== undefined) {
          const note = writeDocumentationLinks(ts, links);
          if (note !== undefined) adjusted.push(note);
        }
        if (typeof p.name === 'string') ts.name = p.name;
        if (fontName !== undefined) {
          // Declared as `FontName` though the API accepts a `FontNameInput` — see create_text_style.
          ts.fontName = fontName as FontName;
          // loadFontAsync is cached, so this costs nothing; it is the face the writes below need.
          await figmaCtx.loadFontAsync(ts.fontName);
        }
        if (typeof p.fontSize === 'number') ts.fontSize = p.fontSize;
        if (lineHeight !== undefined) ts.lineHeight = lineHeight;
        if (p.letterSpacing !== undefined) {
          const ls = p.letterSpacing as SerializedLetterSpacing;
          ts.letterSpacing = { unit: ls.unit as 'PIXELS' | 'PERCENT', value: ls.value };
        }
        if (typeof p.textWrapStyle === 'string') {
          ts.textWrapStyle = p.textWrapStyle as TextStyle['textWrapStyle'];
        }
        if (typeof p.description === 'string') ts.description = p.description;
        // Last, so a bound field wins over a literal set for the same field above.
        if (bindings !== undefined && table !== undefined) {
          await applyTextStyleBindings(figmaCtx, ts, bindings, table);
        }
      },
      () => restoreTextStyle(figmaCtx, ts, before),
      () => textStyleResidue(ts, before),
    );

    const result: StyleResult = { ok: true, styleId: ts.id, name: ts.name };
    if (adjusted.length > 0) result.adjusted = adjusted.join('; ');
    return result;
  };
