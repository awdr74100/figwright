import type { BatchNodeResult } from '@figwright/shared';

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

export interface FindReplacePlan {
  matches: TextNode[];
  find: string;
  replace: string;
  caseSensitive: boolean;
}

/**
 * The TEXT nodes a find/replace would rewrite. Shared with the batch inverse so the nodes it
 * snapshots are exactly the nodes this handler changes — two copies of the match rule would drift.
 * `where` prefixes the errors (the tool name, or the batch op naming it).
 */
export const findReplacePlan = async (
  figmaCtx: typeof figma,
  params: unknown,
  where: string,
): Promise<FindReplacePlan> => {
  const p = (params ?? {}) as {
    find?: unknown;
    replace?: unknown;
    root?: unknown;
    caseSensitive?: unknown;
  };
  if (typeof p.find !== 'string' || p.find === '') {
    throw new TypeError(`${where}: find must be a non-empty string`);
  }
  if (typeof p.replace !== 'string') throw new TypeError(`${where}: replace must be a string`);

  let root: BaseNode;
  if (typeof p.root === 'string') {
    const node = await figmaCtx.getNodeByIdAsync(p.root);
    if (node === null || !('findAllWithCriteria' in node)) {
      throw new Error(`${where}: root ${p.root} not found or cannot be searched`);
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
  return { matches, find: p.find, replace: p.replace, caseSensitive };
};

/** Replace a substring across all TEXT nodes under a scope (default current page). */
export const createFindReplaceTextHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const { matches, find, replace, caseSensitive } = await findReplacePlan(
      figmaCtx,
      params,
      'find_replace_text',
    );
    // Load every match's fonts up front so the mutation pass stays synchronous.
    await Promise.all(matches.map(text => loadAllFonts(figmaCtx, text)));

    const affected: string[] = [];
    for (const text of matches) {
      text.characters = caseSensitive
        ? text.characters.split(find).join(replace)
        : text.characters.replace(new RegExp(escapeRegExp(find), 'gi'), replace);
      affected.push(text.id);
    }

    const result: BatchNodeResult = { ok: true, affected };
    return result;
  };
