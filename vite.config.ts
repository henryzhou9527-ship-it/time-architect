import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'path';
import { cpSync, existsSync } from 'fs';

function copyLegacyAssets() {
  return {
    name: 'copy-legacy-assets',
    closeBundle() {
      const pairs = [
        ['js', 'dist/js'],
        ['css', 'dist/css'],
      ];
      for (const [src, dest] of pairs) {
        if (existsSync(src)) {
          cpSync(src, dest, { recursive: true });
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [preact(), copyLegacyAssets()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 4175,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
