// Bundles the side panel and the service worker into packages/extension/build/ (load it unpacked in Chrome).
import { build } from 'vite'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
await build({
  root,
  logLevel: 'warn',
  publicDir: 'public',
  esbuild: { charset: 'ascii' },
  // Device-flow sign-in needs a GitHub OAuth app; without its client ID the panel offers token sign-in only.
  define: { __GITHUB_CLIENT_ID__: JSON.stringify(process.env.PR_REVIEWER_GITHUB_CLIENT_ID ?? '') },
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

// Content scripts cannot be ES modules: the Review button is built on its own as one classic script.
await build({
  root,
  logLevel: 'warn',
  publicDir: false,
  esbuild: { charset: 'ascii' },
  build: {
    outDir: 'build',
    emptyOutDir: false,
    target: 'chrome116',
    minify: true,
    lib: { entry: fileURLToPath(new URL('src/content.ts', import.meta.url)), formats: ['iife'], name: 'prReviewerButton', fileName: () => 'content.js' },
  },
})
