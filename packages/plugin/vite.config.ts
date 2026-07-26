import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

import pkg from '../mcp/package.json' with { type: 'json' };

// Single product version, sourced from the published package (@figwright/mcp).
const { version } = pkg;

export default defineConfig({
  root: 'ui',
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [vue(), tailwindcss(), viteSingleFile()],
  build: {
    outDir: '../dist',
    emptyOutDir: false,
    target: 'baseline-widely-available',
    rollupOptions: {
      input: 'ui/index.html',
    },
  },
});
