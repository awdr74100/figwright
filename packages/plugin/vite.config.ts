import { readFileSync } from 'node:fs';

import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Single product version, sourced from the published package (@figwright/mcp).
const { version } = JSON.parse(
  readFileSync(new URL('../mcp/package.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig({
  root: 'ui',
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [vue(), tailwindcss(), viteSingleFile()],
  build: {
    outDir: '../dist',
    emptyOutDir: false,
    target: 'es2017',
    rollupOptions: {
      input: 'ui/index.html',
    },
  },
});
