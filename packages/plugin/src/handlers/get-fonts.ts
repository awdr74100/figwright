import type { FontUsage, GetFontsResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { serializeFontName } from '../serializer.js';
import { walk } from '../traverse.js';

const isFontName = (value: unknown): value is FontName =>
  typeof value === 'object' && value !== null && 'family' in value && 'style' in value;

/**
 * Tally key. A variable font's axis values are part of what makes two usages different type — a
 * heading at wght 700 and body at wght 400 can share `Inter Regular` as their named instance — so
 * they belong in the key, sorted so the key is stable regardless of how Figma orders the axes.
 */
const usageKey = (font: FontName): string => {
  const settings = font.variationSettings;
  const axes =
    settings === undefined
      ? ''
      : Object.keys(settings)
          .toSorted()
          .map(tag => `${tag}=${String(settings[tag])}`)
          .join(',');
  return `${font.family} ${font.style} ${axes}`;
};

export const createGetFontsHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async () => {
    const usage = new Map<string, FontUsage>();
    const tally = (font: FontName): void => {
      const key = usageKey(font);
      const entry = usage.get(key);
      if (entry === undefined) {
        usage.set(key, { fontName: serializeFontName(font), count: 1 });
      } else {
        entry.count += 1;
      }
    };

    for (const node of walk(figmaCtx.currentPage.children)) {
      if (node.type !== 'TEXT' && node.type !== 'TEXT_PATH') continue;
      const text = node as TextNode | TextPathNode;
      if (isFontName(text.fontName)) {
        tally(text.fontName);
      } else {
        // Mixed fonts across the text: count each styled segment's font.
        for (const segment of text.getStyledTextSegments(['fontName'])) tally(segment.fontName);
      }
    }

    const fonts = [...usage.values()].toSorted(
      (a, b) =>
        b.count - a.count ||
        a.fontName.family.localeCompare(b.fontName.family) ||
        a.fontName.style.localeCompare(b.fontName.style),
    );
    const result: GetFontsResult = { fonts };

    // Which axes each family exposes — the tags the write tools will accept in
    // `fontName.variationSettings`. Family-wide, so it is reported once per family beside `fonts`
    // rather than repeated on every style row. The API is newer than the oldest editor this plugin
    // runs in, hence the capability check; and it throws for a family the editor does not have,
    // which a document with missing fonts really does contain — a family we cannot ask about is
    // simply left out, which reads the same as static and is the honest answer either way.
    if (typeof figmaCtx.getFontFamilyVariationAxes === 'function') {
      const variationAxes: Record<string, string[]> = {};
      for (const family of new Set(fonts.map(f => f.fontName.family))) {
        try {
          const axes = figmaCtx.getFontFamilyVariationAxes(family);
          if (axes !== null && axes.length > 0) variationAxes[family] = [...axes];
        } catch {
          // Family not available in this editor (missing font) — no axes to report.
        }
      }
      if (Object.keys(variationAxes).length > 0) result.variationAxes = variationAxes;
    }

    return result;
  };
