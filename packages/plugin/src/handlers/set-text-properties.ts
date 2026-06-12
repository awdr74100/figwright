import type { MutateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/**
 * Set a TEXT node's typography + layout/overflow props. Typography (fontName/fontSize/lineHeight/
 * letterSpacing/textCase/textDecoration) mutates the node's runs, so Figma requires every font on
 * the node — plus the target fontName, if changing it — to be loaded first. Layout/overflow props
 * (textAutoResize/truncation/maxLines) are node-level and need no font load. Applied in order
 * autoResize → truncation → maxLines because maxLines only takes effect once truncation is ENDING.
 */
export const createSetTextPropertiesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      nodeId?: unknown;
      fontName?: { family: string; style: string };
      fontSize?: unknown;
      lineHeight?: unknown;
      letterSpacing?: unknown;
      textCase?: unknown;
      textDecoration?: unknown;
      textTruncation?: unknown;
      maxLines?: unknown;
      textAutoResize?: unknown;
    };
    if (typeof p.nodeId !== 'string')
      throw new TypeError('set_text_properties: nodeId must be a string');
    if (p.textAutoResize !== undefined && typeof p.textAutoResize !== 'string') {
      throw new TypeError('set_text_properties: textAutoResize must be a string');
    }
    if (p.textTruncation !== undefined && typeof p.textTruncation !== 'string') {
      throw new TypeError('set_text_properties: textTruncation must be a string');
    }
    if (p.maxLines !== undefined && p.maxLines !== null && typeof p.maxLines !== 'number') {
      throw new TypeError('set_text_properties: maxLines must be a number or null');
    }

    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || node.type !== 'TEXT') {
      throw new Error(`set_text_properties: node ${p.nodeId} is not a TEXT node`);
    }
    const text = node as TextNode;

    // Typography mutations require fonts loaded. Load the node's current font(s) (so range mutations
    // like fontSize/letterSpacing succeed) plus the new fontName, if one is being assigned.
    const settingTypography =
      p.fontName !== undefined ||
      p.fontSize !== undefined ||
      p.lineHeight !== undefined ||
      p.letterSpacing !== undefined ||
      p.textCase !== undefined ||
      p.textDecoration !== undefined;
    if (settingTypography) {
      const fonts: FontName[] =
        text.fontName === figmaCtx.mixed && text.characters.length > 0
          ? text.getRangeAllFontNames(0, text.characters.length)
          : [text.fontName as FontName];
      if (p.fontName !== undefined) fonts.push(p.fontName);
      await Promise.all(fonts.map(font => figmaCtx.loadFontAsync(font)));

      if (p.fontName !== undefined) text.fontName = p.fontName;
      if (p.fontSize !== undefined) text.fontSize = p.fontSize as number;
      if (p.lineHeight !== undefined) text.lineHeight = p.lineHeight as LineHeight;
      if (p.letterSpacing !== undefined) text.letterSpacing = p.letterSpacing as LetterSpacing;
      if (p.textCase !== undefined) text.textCase = p.textCase as TextNode['textCase'];
      if (p.textDecoration !== undefined)
        text.textDecoration = p.textDecoration as TextNode['textDecoration'];
    }

    if (p.textAutoResize !== undefined)
      text.textAutoResize = p.textAutoResize as TextNode['textAutoResize'];
    if (p.textTruncation !== undefined)
      text.textTruncation = p.textTruncation as TextNode['textTruncation'];
    if (p.maxLines !== undefined) text.maxLines = p.maxLines as number | null;

    const result: MutateResult = { ok: true, nodeId: text.id };
    return result;
  };
