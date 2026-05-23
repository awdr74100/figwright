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
  fixedExtension: true,
  deps: { alwaysBundle: ['@figma-mcp-relay/shared'] },
  outputOptions: {
    banner: '#!/usr/bin/env node',
  },
});
