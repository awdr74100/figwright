// Directories never worth walking when scanning a repo (components, CSS entries, token sources).
// Shared so the component scanner, the profile's CSS probe, and the token aggregator stay in lockstep
// — adding a build/vendor dir here covers every repo walk at once instead of drifting per copy.
export const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.git',
  'coverage',
]);

/** True when any path segment is an ignored (vendor/build) directory. */
export const isIgnoredPath = (relPath: string): boolean =>
  relPath.split('/').some(seg => IGNORED_DIRS.has(seg));
