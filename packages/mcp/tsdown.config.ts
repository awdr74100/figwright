import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: 'esm',
  target: 'node24',
  platform: 'node',
  dts: true,
  sourcemap: true,
  clean: true,
  shims: false,
  // Build stamp for newest-build-wins election (src/build-id.ts). Epoch ms of this build; absent
  // (→ 0) when running unbundled, so only real builds participate in build ordering.
  define: {
    __FIGWRIGHT_BUILD_ID__: JSON.stringify(String(Date.now())),
  },
  fixedExtension: true,
  publint: true,
  deps: { alwaysBundle: ['@figwright/shared'] },
  outputOptions: {
    banner: '#!/usr/bin/env node',
  },
});
