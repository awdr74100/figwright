import type { BatchNodeResult } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Load every font used by a (possibly mixed) text node so its characters can be mutated. */
const loadAllFonts = async (figmaCtx: typeof figma, text: TextNode): Promise<void> => {
  const fonts =
    text.fontName === figmaCtx.mixed && text.characters.length > 0
      ? text.getRangeAllFontNames(0, text.characters.length)
      : [text.fontName as FontName];
  await Promise.all(fonts.map(font => figmaCtx.loadFontAsync(font)));
};

/** Replace a substring across all TEXT nodes under a scope (default current page). */
export const createFindReplaceTextHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      find?: unknown;
      replace?: unknown;
      rootId?: unknown;
      caseSensitive?: unknown;
    };
    if (typeof p.find !== 'string' || p.find === '') {
      throw new TypeError('find_replace_text: find must be a non-empty string');
    }
    if (typeof p.replace !== 'string') throw new TypeError('find_replace_text: replace must be a string');

    let root: BaseNode;
    if (typeof p.rootId === 'string') {
      const node = await figmaCtx.getNodeByIdAsync(p.rootId);
      if (node === null || !('findAllWithCriteria' in node)) {
        throw new Error(`find_replace_text: root ${p.rootId} not found or cannot be searched`);
      }
      root = node;
    } else {
      root = figmaCtx.currentPage;
    }

    const caseSensitive = p.caseSensitive === true;
    const needle = caseSensitive ? p.find : p.find.toLowerCase();
    const textNodes = (
      root as unknown as { findAllWithCriteria: (c: { types: ['TEXT'] }) => TextNode[] }
    ).findAllWithCriteria({ types: ['TEXT'] });

    const matches = textNodes.filter(text => {
      const haystack = caseSensitive ? text.characters : text.characters.toLowerCase();
      return haystack.includes(needle);
    });
    // Load every match's fonts up front so the mutation pass stays synchronous.
    await Promise.all(matches.map(text => loadAllFonts(figmaCtx, text)));

    const affected: string[] = [];
    for (const text of matches) {
      text.characters = caseSensitive
        ? text.characters.split(p.find).join(p.replace)
        : text.characters.replace(new RegExp(escapeRegExp(p.find), 'gi'), p.replace);
      affected.push(text.id);
    }

    const result: BatchNodeResult = { ok: true, affected };
    return result;
  };
