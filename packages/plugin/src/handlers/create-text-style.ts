import type {
  SerializedFontName,
  SerializedLetterSpacing,
  SerializedLineHeight,
  StyleResult,
} from '@figma-mcp-relay/shared';

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
      description?: unknown;
    };
    if (typeof p.name !== 'string') throw new TypeError('create_text_style: name must be a string');

    const style = figmaCtx.createTextStyle();
    style.name = p.name;
    if (p.fontName !== undefined) {
      const fn = p.fontName as SerializedFontName;
      await figmaCtx.loadFontAsync({ family: fn.family, style: fn.style });
      style.fontName = { family: fn.family, style: fn.style };
    }
    if (typeof p.fontSize === 'number') style.fontSize = p.fontSize;
    if (p.lineHeight !== undefined)
      style.lineHeight = toFigmaLineHeight(p.lineHeight as SerializedLineHeight);
    if (p.letterSpacing !== undefined) {
      const ls = p.letterSpacing as SerializedLetterSpacing;
      style.letterSpacing = { unit: ls.unit as 'PIXELS' | 'PERCENT', value: ls.value };
    }
    if (typeof p.description === 'string') style.description = p.description;

    const result: StyleResult = { ok: true, styleId: style.id, name: style.name };
    return result;
  };
