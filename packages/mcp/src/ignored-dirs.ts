// Directories never worth walking when scanning a repo (components, CSS entries, token sources).
// Shared so the component scanner, the profile's CSS probe, and the token aggregator stay in lockstep
// — adding a build/vendor dir here covers every repo walk at once instead of drifting per copy.
//
// `vendor` is the one that bites hardest: a PHP (Composer) / Ruby (Bundler) vendor dir holds tens of
// thousands of files. It contains no .tsx/.vue/.css we'd match, so a post-filter wouldn't drop
// anything — but node:fs glob still *descends* into it to find that out, and that traversal is linear
// in the vendor's size (measured ~90ms for 24k files, and real vendors are far bigger). The fix isn't
// the list, it's pruning at the glob level (globExclude) so the walk never enters these dirs at all.
export const IGNORED_DIRS = new Set([
  'node_modules',
  'vendor', // PHP Composer / Ruby Bundler — huge, and invisible to a post-filter
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.output', // Nuxt 3 build
  '.svelte-kit', // SvelteKit build
  '.turbo',
  '.cache',
  '.git',
  'coverage',
]);

/** True when any path segment is an ignored (vendor/build) directory. */
export const isIgnoredPath = (relPath: string): boolean =>
  relPath.split('/').some(seg => IGNORED_DIRS.has(seg));

/**
 * Pruning callback for node:fs `glob({ exclude })`. Unlike a post-filter, this stops the walk from
 * descending into an ignored directory, so traversal cost is independent of how large node_modules
 * / vendor are. node passes either a Dirent (has `.name`) or a path string depending on version, so
 * accept both and key on the basename — matching IGNORED_DIRS' per-segment semantics.
 */
export const globExclude = (entry: { name: string } | string): boolean => {
  const name = typeof entry === 'string' ? (entry.split('/').pop() ?? entry) : (entry.name ?? '');
  return IGNORED_DIRS.has(name);
};
