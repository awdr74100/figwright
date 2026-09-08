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
//   3. cap — a terminal limit on kept files, the last line against a pathological repo with a huge
//      custom dir that's neither baseline nor gitignored. Note what it does *not* buy: a repo whose
//      bulk doesn't match `extensions` never fills the cap in the first place, so the cap bounds how
//      many files a caller receives, not how much tree gets walked (measured: 50k non-matching files
//      cost the same either way).
//
// The .gitignore layer is a *union* on top of the baseline, never a replacement — so "no .gitignore"
// degrades exactly to the baseline-only behavior (no regression), and "has .gitignore" only adds
// precision (skips gitignored source-like files the baseline would miss). The matcher needs full
// repo-relative posix paths (rules can be anchored / path-specific), which is why the walk forces a
// `/` separator on every platform.

const DEFAULT_CAP = 5000;

/**
 * How far the in-flight buffer may grow past `cap` before it is sorted and trimmed back. Any value
 * above 1 gives the same result; it only trades trim frequency against peak memory on a repo far
 * above its cap.
 */
const TRIM_FACTOR = 4;

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
  /** Only return files with these extensions (leading dot optional). Omitted → every file. */
  extensions?: readonly string[];
  /** Terminal cap on returned paths (pathological-repo safety). Default 5000. */
  cap?: number;
}

export interface RepoWalk {
  /** Repo-relative paths (posix-separated) of the matching files, in canonical order. */
  files: string[];
  /**
   * How many files matched but did not fit under `cap`. Zero is the load-bearing value: it is what
   * lets a caller state its result over "the project's stylesheets" rather than over a sample of
   * them. Above zero, whatever the caller concluded is drawn from `files.length` of `files.length +
   * omitted` candidates, and saying so is the difference between a partial answer and a wrong one —
   * a token pool missing a third of the repo looks exactly like a repo that never declared those
   * tokens.
   */
  omitted: number;
}

/**
 * Walk files under rootDir, skipping baseline + gitignored dirs/files. Pure traversal — callers
 * decide what to do with each path (read + parse, early-stop, aggregate).
 *
 * Returns the whole listing rather than streaming it: the crawl has to finish before the cap can
 * pick deterministically (see below), so there was never anything to yield early.
 */
export const walkRepoFiles = async (rootDir: string, opts: WalkOptions = {}): Promise<RepoWalk> => {
  const cap = opts.cap ?? DEFAULT_CAP;
  const exts = opts.extensions?.map(e => (e.startsWith('.') ? e : `.${e}`));
  const matcher = await buildIgnoreMatcher(rootDir);

  // The cap is applied here rather than with fdir's `withMaxFiles`, because that one is not
  // deterministic: fdir crawls directories concurrently and stops feeding its shared result array
  // once the array passes the limit, so *which* files survive is a race between readdir completions.
  // Sorting afterwards ordered the set it happened to win, it did not make the set stable — measured
  // on the shape of the ordering test below, 10 runs at cap 50 returned 5 different sets of files.
  // That reached the output for every caller with a repo above its cap: token_map's pool, the
  // classNaming tally, and `findTailwindCssEntry`, which takes the *first* match.
  //
  // So `filter` doubles as the collector and returns false, leaving fdir's own result empty, and
  // `kept` is sorted and trimmed back to `cap` whenever it grows past TRIM_FACTOR x cap. What
  // survives is then always the first `cap` paths in canonical order — stable run to run, and a
  // better sample than an arbitrary prefix, since shallow files are the canonical ones (see
  // `byDepthThenPath`). A repo under its cap never trims, so this costs nothing in the ordinary
  // case; a pathological one holds at most TRIM_FACTOR x cap paths at a time, which is what
  // `withMaxFiles` was there to bound.
  const kept: string[] = [];
  const trimAt = Math.max(cap * TRIM_FACTOR, cap + 1);
  let matched = 0;

  await new fdir()
    .withRelativePaths() // repo-relative paths, files only (never directory entries)
    .withPathSeparator('/') // posix on every platform — the gitignore matcher requires it
    // Directory pruning: never descend baseline dirs (node_modules/vendor/…) or dot-directories. fdir
    // hands `exclude` the directory basename, matching IGNORED_DIRS' per-segment semantics.
    .exclude(dirName => dirName.startsWith('.') || IGNORED_DIRS.has(dirName))
    .filter(path => {
      const base = path.slice(path.lastIndexOf('/') + 1);
      if (base.startsWith('.')) return false; // dotfile — parity with node:fs glob (`*` skips leading dot)
      if (exts !== undefined && !exts.some(e => base.endsWith(e))) return false;
      if (matcher.ignores(path)) return false; // gitignored source-like file (negation-aware)
      matched += 1;
      kept.push(path);
      if (kept.length >= trimAt) {
        kept.sort(byDepthThenPath);
        kept.length = cap;
      }
      return false; // fdir keeps nothing — `kept` above is the result
    })
    .crawl(rootDir)
    .withPromise();

  kept.sort(byDepthThenPath);
  if (kept.length > cap) kept.length = cap;
  return { files: kept, omitted: matched - kept.length };
};

/**
 * Canonical order for a repo listing: shallowest path first, then by code unit.
 *
 * Deterministic is the point, and the disorder was measured rather than assumed: fdir crawls
 * directories concurrently, so two runs over the same unchanged repo return the same _set_ of files
 * in a different order. On Bulma the first three differed between consecutive runs. That reached
 * the output — `token_map`'s note listed a different sample of files each time, and on a repo where
 * several files declare one token name the `from` handed back changed run to run. Same input,
 * different answer.
 *
 * Depth leads rather than plain a-z as a tie-break _preference_, not as a fix for a proven bug: one
 * caller takes the first match rather than aggregating (`findTailwindCssEntry`), and a Tailwind v4
 * entry is conventionally shallow (`src/index.css`), so ranking `src/index.css` above
 * `src/a/b/c.css` is the better guess where plain a-z would invert them. Note the limits — this
 * does not disambiguate two candidates at the _same_ depth, and no fixture made that caller vary
 * between runs in the first place, so its stability is a by-product here, not a repair.
 *
 * Compared with `<` rather than localeCompare on purpose — locale-aware collation varies by
 * environment, which is the property this function exists to remove.
 */
const byDepthThenPath = (a: string, b: string): number => {
  const byDepth = pathDepth(a) - pathDepth(b);
  if (byDepth !== 0) return byDepth;
  if (a < b) return -1;
  return a > b ? 1 : 0;
};

/** How many directories deep a repo-relative posix path sits. */
const pathDepth = (path: string): number => {
  let n = 0;
  for (const ch of path) if (ch === '/') n += 1;
  return n;
};

/**
 * The one sentence a tool result carries when its walk hit the cap. A note, not an inventory: what
 * the caller has to know is that its answer came from a subset, and naming the files would bury
 * that under a wall of paths — the same rule the token notes follow. Costs nothing on a repo under
 * the cap, where the field is absent entirely.
 */
export const truncationNote = (kind: string, omitted: number): string =>
  `file cap reached: ${omitted} further ${kind} were not read, so a missing match may simply be outside what was scanned`;
