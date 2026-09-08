import { fdir } from 'fdir';

// Why this file exists: a design-token *build* tool emits perfectly readable CSS or SCSS, and then
// writes it where every repo walk in this server refuses to look. `build/`, `dist/` and `out/` are
// pruned at the directory level (see IGNORED_DIRS) because they are normally generated junk — but a
// project that commits its token output there has put the one file we want inside the one place we
// skip. Style Dictionary's own basic example uses `buildPath: "build/"`, so this is the documented
// layout, not an unusual one.
//
// The result today is an empty pool under the note "no token source detected; pass tokenSource" —
// technically the right advice, and useless: it does not say a token pipeline was found, or where
// its output landed. That note is read by an agent, which can act on it by calling token_map again
// with `tokenSource` — so naming the actual candidate files turns a dead end into one more call.
//
// Deliberately *naming* rather than reading. A `dist/` can hold a bundled vendor stylesheet that is
// not this project's tokens at all; pointing at a file and letting the caller confirm keeps that
// judgement where it belongs, and keeps the pruning that makes every other walk fast.

/** Packages whose presence means "this project generates its design tokens into a file". */
const TOKEN_BUILD_TOOLS: ReadonlyMap<string, string> = new Map([
  ['style-dictionary', 'Style Dictionary'],
  // The Tokens Studio → Style Dictionary bridge: a Figma plugin's export feeding a token build.
  ['@tokens-studio/sd-transforms', 'Tokens Studio + Style Dictionary'],
  ['@terrazzo/cli', 'Terrazzo'],
  ['@cobalt-ui/cli', 'Cobalt'],
  ['theo', 'Theo'],
]);

/** Pruned directories a build tool actually writes to. The rest hold no hand-referenced tokens. */
const OUTPUT_DIRS = ['build', 'dist', 'out'] as const;

const STYLESHEET_EXTENSIONS = ['.css', '.scss'] as const;

/** Enough to name in a note; a caller picks one, so an exhaustive list helps nobody. */
const MAX_NAMED = 8;

/** Guard against a committed `dist/` of thousands of files — this runs only on an empty pool. */
const CRAWL_CAP = 400;

/** The display name of a token build tool in these dependencies, or null when there is none. */
export const detectTokenBuildTool = (deps: Readonly<Record<string, unknown>>): string | null => {
  for (const [pkg, label] of TOKEN_BUILD_TOOLS) if (pkg in deps) return label;
  return null;
};

// A minified bundle is not a token file; the shortest paths are the likeliest entry points.
const byLikeliestEntry = (a: string, b: string): number =>
  a.length - b.length || a.localeCompare(b);

/**
 * Stylesheets sitting in the conventionally-pruned output directories, repo-relative and sorted so
 * the answer is stable. Never throws — a missing directory is simply no candidates.
 *
 * The cap is applied through `filter` for the same reason `walkRepoFiles` does it: fdir's
 * `withMaxFiles` truncates a concurrently-built array, so above the cap _which_ files survive is a
 * race, and sorting after the fact only orders a set that was already chosen at random.
 *
 * Unlike the walker, this one was never caught returning different answers — probed at 40, 200 and
 * 1240-file `dist/` layouts, flat and nested, it was stable every time, because the shortest paths
 * this ranks first are the ones nearest the crawl root and fdir reaches those before any
 * concurrency can reorder anything. So this closes the race by construction rather than fixing an
 * observed failure; the cost is one full crawl of an oversized `dist/` (8.3ms → 12.4ms over 20k
 * files) on a path that only runs when the token pool came back empty.
 */
export const findGeneratedStylesheets = async (rootDir: string): Promise<string[]> => {
  const found: string[] = [];
  for (const dir of OUTPUT_DIRS) {
    const kept: string[] = [];
    try {
      // eslint-disable-next-line no-await-in-loop -- three fixed directories; clarity over batching
      await new fdir()
        .withRelativePaths()
        .withPathSeparator('/')
        .exclude(name => name.startsWith('.') || name === 'node_modules')
        .filter(path => {
          const base = path.slice(path.lastIndexOf('/') + 1);
          if (base.startsWith('.') || !STYLESHEET_EXTENSIONS.some(e => base.endsWith(e))) {
            return false;
          }
          kept.push(path);
          if (kept.length >= CRAWL_CAP * 2) {
            kept.sort(byLikeliestEntry);
            kept.length = CRAWL_CAP;
          }
          return false; // fdir keeps nothing — `kept` is the result
        })
        .crawl(`${rootDir}/${dir}`)
        .withPromise();
    } catch {
      continue;
    }
    kept.sort(byLikeliestEntry);
    found.push(...kept.slice(0, CRAWL_CAP).map(rel => `${dir}/${rel}`));
  }
  return found.toSorted(byLikeliestEntry).slice(0, MAX_NAMED);
};
