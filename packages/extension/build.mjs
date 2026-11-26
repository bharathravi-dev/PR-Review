// Bundles the side panel and the service worker into packages/extension/build/ (load it unpacked in Chrome).
import { build } from 'vite'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
await build({
  root,
  logLevel: 'warn',
  publicDir: 'public',
  build: {
    outDir: 'build',
    emptyOutDir: true,
    target: 'chrome116',
    minify: true,
    sourcemap: false,
    modulePreload: false,
    chunkSizeWarningLimit: 12000,
    rollupOptions: {
      input: { panel: fileURLToPath(new URL('panel.html', import.meta.url)), background: fileURLToPath(new URL('src/background.ts', import.meta.url)) },
      output: { entryFileNames: '[name].js', chunkFileNames: 'chunks/[name].js', assetFileNames: 'assets/[name][extname]' },
    },
  },
})
