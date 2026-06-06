import { glob, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { globExclude, isIgnoredPath } from '../ignored-dirs.js';
import { parseCssCustomProperties, type ProjectToken } from './tokens.js';

// The token join's right-hand side when there's no single detected CSS config — i.e. a non-Tailwind
// project that defines its design tokens as plain CSS custom properties (:root { --primary: … }), or
// a Tailwind project whose @theme entry wasn't located. Rather than guess *which* CSS file is "the"
// token source (no reliable marker exists, unlike Tailwind's @import/@theme), aggregate the custom
// properties from every hand-authored CSS file and let token_map's join filter them: a Figma variable
// only surfaces a candidate when name- or value-match agrees, so incidental vars (--header-height,
// reset rules) sit in the pool unmatched and never reach the output. Worst case the pool matches
// nothing and the result is identical to today's empty join — so the fallback can't regress.

const MAX_CSS_FILES = 200; // safety cap against pathological repos

export interface AggregatedCss {
  tokens: ProjectToken[];
  /** Repo-relative CSS files that contributed at least one custom property. */
  files: string[];
}

/**
 * Walk every CSS file in the repo (skipping vendored/build dirs), parse its custom properties, and
 * pool them. Tokens are kept as-is (no cross-file de-dup): the join prefers an exact value-match,
 * so a name collision across files resolves to the right-valued token when the Figma side carries a
 * hex.
 */
export const aggregateRepoCssTokens = async (rootDir: string): Promise<AggregatedCss> => {
  const tokens: ProjectToken[] = [];
  const files: string[] = [];
  let scanned = 0;

  for await (const entry of glob('**/*.css', { cwd: rootDir, exclude: globExclude })) {
    const rel = typeof entry === 'string' ? entry : String(entry);
    if (isIgnoredPath(rel)) continue;
    if (scanned >= MAX_CSS_FILES) break;
    scanned += 1;
    let body: string;
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential repo walk; clarity over batching
      body = await readFile(join(rootDir, rel), 'utf8');
    } catch {
      continue;
    }
    const parsed = parseCssCustomProperties(body);
    if (parsed.length > 0) {
      tokens.push(...parsed);
      files.push(rel);
    }
  }
  return { tokens, files };
};
