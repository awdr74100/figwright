import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  root: 'ui',
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
