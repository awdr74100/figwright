import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { walkRepoFiles } from '../repo-walk.js';
import { parseCssCustomProperties, parseScssVariables, type ProjectToken } from './tokens.js';

// The token join's right-hand side for a SCSS project, which until now read nothing at all: `scss`
// has been a detected styling system since before the join existed, but every token source was CSS,
// so such a project joined against an empty pool.
//
// Aggregated rather than pointed at one file, for the same reason the CSS pool is: there is no
// reliable marker for *the* variables file. Real projects range from Bootstrap's single 952-entry
// `_variables.scss` to Vuetify's ~90 per-component ones, and the join filters the pool anyway — a
// Figma variable only surfaces a candidate when name or value agrees, so a component-local
// `$alert-padding` sits unmatched and never reaches the output.
//
// Both kinds of declaration in a `.scss` file count, because modern SCSS projects routinely use
// both and reading only one would leave half of them still joining against nothing:
//
//   - `$name: value` — a Sass variable. Its reference needs an `@use` of the declaring file, so the
//     token carries `from`; see `ProjectToken`'s ref union.
//   - `:root { --name: value }` — a real CSS custom property that happens to be written in a `.scss`
//     file. It compiles through untouched, so `var(--name)` resolves with no import at all, and it
//     is the ordinary CSS arm of that union.

const MAX_SCSS_FILES = 300; // Vuetify alone ships ~120; the cap is a rail, not a budget.

export interface AggregatedScss {
  tokens: ProjectToken[];
  /** Repo-relative `.scss` files that contributed at least one token. */
  files: string[];
}

/**
 * Walk every `.scss` file in the repo and pool what it declares. Directory pruning + .gitignore
 * handling live in walkRepoFiles.
 *
 * `.sass` (the indented syntax) is deliberately not walked: its declarations are newline-terminated
 * rather than `;`-terminated, which the scanner's value reader would run straight past — a token
 * whose value swallows the following lines is worse than no token, which is the rule this whole
 * reader is built on.
 */
export const aggregateRepoScssTokens = async (rootDir: string): Promise<AggregatedScss> => {
  const tokens: ProjectToken[] = [];
  const files: string[] = [];

  for await (const rel of walkRepoFiles(rootDir, { extensions: ['.scss'], cap: MAX_SCSS_FILES })) {
    let body: string;
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential repo walk; clarity over batching
      body = await readFile(join(rootDir, rel), 'utf8');
    } catch {
      continue;
    }
    const parsed = [...parseScssVariables(body, rel), ...parseCssCustomProperties(body, true)];
    if (parsed.length > 0) {
      tokens.push(...parsed);
      files.push(rel);
    }
  }
  return { tokens, files };
};
