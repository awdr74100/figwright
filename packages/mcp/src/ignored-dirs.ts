// Directories never worth walking when scanning a repo (components, CSS entries, token sources).
// Shared so the component scanner, the profile's CSS probe, and the token aggregator stay in lockstep
// — adding a build/vendor dir here covers every repo walk at once instead of drifting per copy.
//
// `vendor` is the one that bites hardest: a PHP (Composer) / Ruby (Bundler) vendor dir holds tens of
// thousands of files. It contains no .tsx/.vue/.css we'd match, so a post-filter wouldn't drop
// anything — but the crawler would still *descend* into it to find that out, and that traversal is
// linear in the vendor's size (and real vendors are far bigger). The fix isn't the list, it's pruning
// at the directory level (fdir's `exclude`, keyed on the dir basename) so the walk never enters these
// dirs at all. Dot-directories are pruned separately by the walker, so the entries below only need to
// cover the *non-dot* build/vendor dirs — the dot ones are kept as explicit, self-documenting intent.
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
