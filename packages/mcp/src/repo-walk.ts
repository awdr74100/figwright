import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { fdir } from 'fdir';
import ignore, { type Ignore } from 'ignore';

import { IGNORED_DIRS } from './ignored-dirs.js';

// The one repo file walk shared by every server-side scan (components, the Tailwind CSS probe, the
// token aggregator). "What to skip" is layered defense-in-depth so it's correct with OR without a
// .gitignore:
//
//   1. .gitignore (+ .git/info/exclude) — the target project's own, authoritative declaration of what
//      isn't hand-written source. Read when present; honored via the `ignore` package (gitignore-spec
//      matcher: anchoring, globs, negation, directory rules). Applied per *file* so negations survive
//      (`!Special.tsx` under `*.tsx` re-includes) — a directory-level prune couldn't put a negated
//      child back. This is the strongest, most general signal — it auto-covers a project's
//      vendor/build/generated dirs without us hardcoding them.
//   2. IGNORED_DIRS baseline (+ dotfiles/dot-dirs) — pruned at the traversal level (fdir `exclude`), so
//      node_modules / vendor are never descended into (cost independent of their size). This is the
//      *fallback*: when a project has no .gitignore, this is the only directory defense, so it must
//      stay. Dot-directories and dotfiles are skipped too, matching the prior node:fs glob semantics
//      (its `*`/`**` never crossed a leading dot).
//   3. cap — a terminal limit (fdir `withMaxFiles`, which counts kept files and early-stops the walk),
//      the last line against a pathological repo with a huge custom dir that's neither baseline nor
//      gitignored.
//
// The .gitignore layer is a *union* on top of the baseline, never a replacement — so "no .gitignore"
// degrades exactly to the baseline-only behavior (no regression), and "has .gitignore" only adds
// precision (skips gitignored source-like files the baseline would miss). The matcher needs full
// repo-relative posix paths (rules can be anchored / path-specific), which is why the walk forces a
// `/` separator on every platform.

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
 * Walk files under rootDir, skipping baseline + gitignored dirs/files. Pure traversal — callers
 * decide what to do with each path (read + parse, early-stop, aggregate).
 *
 * @yields Repo-relative paths (posix-separated) of the matching files
 */
export async function* walkRepoFiles(
  rootDir: string,
  opts: WalkOptions = {},
): AsyncGenerator<string> {
  const cap = opts.cap ?? DEFAULT_CAP;
  const exts = opts.extensions?.map(e => (e.startsWith('.') ? e : `.${e}`));
  const matcher = await buildIgnoreMatcher(rootDir);

  const files = await new fdir()
    .withRelativePaths() // repo-relative paths, files only (never directory entries)
    .withPathSeparator('/') // posix on every platform — the gitignore matcher requires it
    .withMaxFiles(cap) // counts kept files and early-stops the walk (pathological-repo guard)
    // Directory pruning: never descend baseline dirs (node_modules/vendor/…) or dot-directories. fdir
    // hands `exclude` the directory basename, matching IGNORED_DIRS' per-segment semantics.
    .exclude(dirName => dirName.startsWith('.') || IGNORED_DIRS.has(dirName))
    .filter(path => {
      const base = path.slice(path.lastIndexOf('/') + 1);
      if (base.startsWith('.')) return false; // dotfile — parity with node:fs glob (`*` skips leading dot)
      if (exts !== undefined && !exts.some(e => base.endsWith(e))) return false;
      return !matcher.ignores(path); // gitignored source-like file (negation-aware)
    })
    .crawl(rootDir)
    .withPromise();

  yield* files;
}
