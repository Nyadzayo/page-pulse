import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync, cpSync } from 'fs';

export default defineConfig({
  root: 'src',
  // .env lives at the repo root, not in src/ (the Vite root) — without
  // this, VITE_TELEMETRY_* would silently resolve to empty strings and
  // telemetry would no-op in every build.
  envDir: __dirname,
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup.html'),
        dashboard: resolve(__dirname, 'src/dashboard.html'),
        offscreen: resolve(__dirname, 'src/offscreen.html'),
        background: resolve(__dirname, 'src/background.js'),
        content: resolve(__dirname, 'src/content.js'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
  plugins: [
    {
      name: 'copy-extension-files',
      closeBundle() {
        const distDir = resolve(__dirname, 'dist');
        // Copy manifest
        copyFileSync(resolve(__dirname, 'manifest.json'), resolve(distDir, 'manifest.json'));
        // Copy icons
        const iconsDir = resolve(distDir, 'icons');
        if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true });
        cpSync(resolve(__dirname, 'icons'), iconsDir, { recursive: true });
        // ExtPay content script — uncomment when enabling payments:
        // copyFileSync(
        //   resolve(__dirname, 'node_modules/extpay/dist/ExtPay.js'),
        //   resolve(distDir, 'ExtPay.js')
        // );
      },
    },
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    root: resolve(__dirname),
    setupFiles: [resolve(__dirname, 'tests/setup.js')],
  },
});
