import { glob, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import ignore, { type Ignore } from 'ignore';

import { globExclude, isIgnoredPath } from './ignored-dirs.js';

// The one repo file walk shared by every server-side scan (components, the Tailwind CSS probe, the
// token aggregator). "What to skip" is layered defense-in-depth so it's correct with OR without a
// .gitignore:
//
//   1. .gitignore (+ .git/info/exclude) — the target project's own, authoritative declaration of what
//      isn't hand-written source. Read when present; honored via the `ignore` package (gitignore-spec
//      matcher: anchoring, globs, negation, directory rules). This is the strongest, most general
//      signal — it auto-covers a project's vendor/build/generated dirs without us hardcoding them.
//   2. IGNORED_DIRS baseline — pruned at the glob level (globExclude), so node_modules / vendor are
//      never descended into (traversal cost independent of their size). This is the *fallback*: when a
//      project has no .gitignore, this is the only directory defense, so it must stay.
//   3. cap — a terminal yield limit, the last line against a pathological repo with a huge custom dir
//      that's neither in the baseline nor gitignored.
//
// The .gitignore layer is a *union* on top of the baseline, never a replacement — so "no .gitignore"
// degrades exactly to the baseline-only behavior (no regression), and "has .gitignore" only adds
// precision (skips gitignored source-like files the baseline would miss). The matcher needs full
// repo-relative paths (rules can be anchored / path-specific), which is why it post-filters the glob
// results rather than riding the basename-only `exclude` callback.

const DEFAULT_CAP = 5000;

/**
 * Read the target project's ignore files into a matcher. An empty matcher ignores nothing — so a
 * project without a .gitignore degrades to baseline-only pruning.
 */
const buildIgnoreMatcher = async (rootDir: string): Promise<Ignore> => {
  const ig = ignore();
  for (const rel of ['.gitignore', '.git/info/exclude']) {
    try {
      // eslint-disable-next-line no-await-in-loop -- two fixed reads; clarity over micro-parallelism
      ig.add(await readFile(join(rootDir, rel), 'utf8'));
    } catch {
      /* not present — fine */
    }
  }
  return ig;
};

export interface WalkOptions {
  /** Only yield files with these extensions (leading dot optional). Omitted → every file. */
  extensions?: readonly string[];
  /** Terminal cap on yielded paths (pathological-repo safety). Default 5000. */
  cap?: number;
}

/**
 * Yield repo-relative paths of files under rootDir, skipping baseline + gitignored dirs/files. Pure
 * traversal — callers decide what to do with each path (read + parse, early-stop, aggregate).
 */
export async function* walkRepoFiles(
  rootDir: string,
  opts: WalkOptions = {},
): AsyncGenerator<string> {
  const cap = opts.cap ?? DEFAULT_CAP;
  const exts = opts.extensions?.map(e => (e.startsWith('.') ? e : `.${e}`));
  // One glob per extension, not a `{a,b}` brace group: node's fs glob won't expand a single-element
  // brace (`**/*{.vue}` finds nothing), which silently sank every single-extension profile.
  const patterns = exts === undefined ? ['**/*'] : exts.map(e => `**/*${e}`);

  const matcher = await buildIgnoreMatcher(rootDir);
  let count = 0;

  for await (const entry of glob(patterns, { cwd: rootDir, exclude: globExclude })) {
    const rel = typeof entry === 'string' ? entry : String(entry);
    const posix = rel.split(/[\\/]/).join('/'); // gitignore matcher wants posix-relative paths
    if (isIgnoredPath(posix)) continue; // defense-in-depth (exclude already pruned these dirs)
    if (matcher.ignores(posix)) continue; // gitignored source-like file
    if (count >= cap) break;
    count += 1;
    yield posix;
  }
}
