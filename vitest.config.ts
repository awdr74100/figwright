import { defineConfig } from 'vitest/config';

/**
 * Root aggregator — one `pnpm test` runs every package in one pass.
 *
 * `projects` discovers each package's own `vitest.config.ts` by glob (the common monorepo pattern —
 * gemini-cli, slidev, hoppscotch), so a package that needs plugins (plugin → `vue()`) keeps them in
 * its own config and out of the root. The repo-root `test/` suite isn't a package, so it's the one
 * inline project here.
 *
 * Coverage is process-wide: Vitest only accepts it in the root config, never per project.
 */
export default defineConfig({
  test: {
    projects: [
      'packages/*/vitest.config.ts',
      {
        test: {
          name: 'root',
          root: import.meta.dirname,
          include: ['test/**/*.{test,spec}.ts'],
          environment: 'node',
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['packages/*/src/**/*.ts', 'packages/*/ui/**/*.ts', 'packages/*/ui/**/*.vue'],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/dist/**'],
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
  },
});
