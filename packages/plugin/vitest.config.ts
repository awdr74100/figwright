import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

/**
 * Per-package config, discovered by the root's `projects` glob. `vue()` lives here — the only place
 * that compiles `.vue` component tests — so `@vitejs/plugin-vue` stays a plugin-package dependency
 * rather than leaking into the root.
 *
 * Environment is `node` by default; the component tests opt into a DOM per file with `//
 * @vitest-environment happy-dom`, keeping the non-DOM tests at Node speed. Icons are plain
 * `@lucide/vue` imports, so there's no virtual-module resolver to wire up.
 */
export default defineConfig({
  plugins: [vue()],
  // Mirrors the build-time define in vite.config.ts so a component that renders the version can mount.
  define: { __APP_VERSION__: JSON.stringify('0.0.0-test') },
  test: {
    name: 'plugin',
    include: ['test/**/*.{test,spec}.ts'],
    environment: 'node',
  },
});
